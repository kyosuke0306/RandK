import { col, ref, onSnapshot } from '../firebase.js';
import { icon } from '../icons.js';
import { esc, yen, monthKey, todayStr, monthLabel, toast } from '../util.js';
import { CATEGORIES, summarize, settleResultHtml } from './money.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const cat = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1);

function greeting() {
  const h = new Date().getHours();
  if (h < 4 || h >= 18) return 'こんばんは';
  if (h < 11) return 'おはよう';
  return 'こんにちは';
}

export function mount(el, { store, views, navigate }) {
  const month = monthKey();
  let bills = null;
  let monthMeta = {};

  const openMoney = () => {
    sessionStorage.setItem('month', month);
    navigate('money');
  };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (!t) return;
    if (t.dataset.go === 'money') openMoney();
    else navigate(t.dataset.go);
  });

  function render() {
    const me = store.member(store.user.uid);
    const members = store.memberList();
    const now = new Date();
    el.innerHTML = `
      <header class="home-head">
        <div>
          <p class="label">${now.getMonth() + 1}月${now.getDate()}日（${WEEK[now.getDay()]}）</p>
          <h1>${greeting()}、${esc(me?.name || '')}</h1>
        </div>
        <div class="avatars">
          ${members.map((m) => (m.photoURL
            ? `<img src="${esc(m.photoURL)}" alt="${esc(m.name)}" referrerpolicy="no-referrer">`
            : `<span class="avatar tone-${m.tone}">${icon('users', 16)}</span>`)).join('')}
        </div>
      </header>
      ${bills ? monthCard() + upcoming() : '<div class="spinner small"></div>'}
      <h2 class="section-title">メニュー</h2>
      <div class="menu-grid">
        ${views.filter((v) => v.id !== 'home').map((v) => `
          <button class="menu-tile" data-go="${v.id}">
            <span class="menu-icon">${icon(v.icon, 24)}</span>
            <span class="menu-label">${v.label}</span>
            <span class="menu-desc">${v.desc || ''}</span>
          </button>`).join('')}
      </div>`;
  }

  function monthCard() {
    const s = summarize(bills, store);
    let settle = '';
    if (!bills.length) {
      settle = '<p class="settle-note">まだ項目がありません。タップして追加しましょう。</p>';
    } else if (monthMeta.settled) {
      settle = `<p class="home-status ok">${icon('checkCircle', 18)}精算済み</p>`;
    } else if (s.unpaid > 0) {
      settle = `<p class="home-status">${icon('circle', 18)}未払いが${s.unpaid}件あります</p>`;
    } else if (s.rows && s.amount > 0) {
      settle = settleResultHtml(s.debtor, s.creditor, s.amount);
    } else {
      settle = `<p class="home-status ok">${icon('checkCircle', 18)}すべて支払済み</p>`;
    }
    return `
      <button class="card total home-month" data-go="money">
        <div class="total-row">
          <div>
            <p class="label">${monthLabel(month)}の合計</p>
            <p class="big">${yen(s.total)}</p>
          </div>
          <span class="muted">${icon('chevronRight', 22)}</span>
        </div>
        <div class="progress"><span style="width:${s.pct}%"></span></div>
        <p class="label">${s.paidBills.length} / ${bills.length} 件 支払済み</p>
        ${settle}
      </button>`;
  }

  function upcoming() {
    const list = bills.filter((b) => !b.paid)
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
      .slice(0, 4);
    if (!list.length) return '';
    const today = todayStr();
    return `
      <h2 class="section-title">これからの支払い</h2>
      <div class="card upcoming">
        ${list.map((b) => {
          const c = cat(b.category);
          const payer = b.payer ? store.member(b.payer) : null;
          const overdue = b.dueDate && b.dueDate < today;
          const due = b.dueDate
            ? `${Number(b.dueDate.slice(5, 7))}/${Number(b.dueDate.slice(8, 10))}${overdue ? ' 期限切れ' : ''}`
            : '期限なし';
          return `
            <button class="upcoming-row" data-go="money">
              <span class="cat-icon cat-${c.id}">${icon(c.icon, 18)}</span>
              <span class="bill-main">
                <span class="bill-name">${esc(b.name || c.label)}</span>
                <span class="bill-meta">
                  <span class="${overdue ? 'overdue' : ''}">${icon('calendar', 13)}${due}</span>
                  ${payer ? `<span class="who tone-${payer.tone}">${esc(payer.name)}</span>` : ''}
                </span>
              </span>
              <span class="bill-amount">${b.amount ? yen(b.amount) : '<span class="muted">未入力</span>'}</span>
            </button>`;
        }).join('')}
      </div>`;
  }

  const unsubs = [
    onSnapshot(col('months', month, 'bills'), (snap) => {
      bills = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (e) => toast(`読み込みに失敗しました (${e.code})`)),
    onSnapshot(ref('months', month), (snap) => {
      monthMeta = snap.data() || {};
      if (bills) render();
    }),
    store.subscribe(render),
  ];
  render();
  return () => unsubs.forEach((u) => u());
}
