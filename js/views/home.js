import {
  col, onSnapshot, query, where, orderBy, limit,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, yen, monthKey, todayStr, monthLabel, toast } from '../util.js';
import { cat, summarize, settleResultHtml } from './money.js';
import { dayLabel, timeLabel, sortEvents } from './calendar.js';
import { sortTodos } from './todo.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 4 || hour >= 18) return 'こんばんは';
  if (hour < 11) return 'おはよう';
  return 'こんにちは';
}

export function mount(el, { store, views, navigate }) {
  const month = monthKey();
  const today = todayStr();
  const data = {
    bills: null, events: null, shopping: null, photos: null, todos: null,
  };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (!t) return;
    if (t.dataset.go === 'money') sessionStorage.setItem('month', month);
    navigate(t.dataset.go);
  });

  function render() {
    const me = store.member(store.user.uid);
    const now = new Date();
    el.innerHTML = `
      <header class="home-head">
        <div>
          <p class="label">${now.getMonth() + 1}月${now.getDate()}日（${WEEK[now.getDay()]}）</p>
          <h1>${greeting()}、${esc(me?.name || '')}</h1>
        </div>
        <div class="head-actions">
          <button class="icon-btn ask-btn" data-go="ask" aria-label="FUTARIに質問">${icon('sparkle', 22)}</button>
          <button class="icon-btn" data-go="settings" aria-label="設定">${icon('settings', 22)}</button>
        </div>
      </header>
      ${data.bills ? monthCard() + upcomingBills() : '<div class="spinner small"></div>'}
      ${nextEvents()}
      ${todoList()}
      ${shopping()}
      ${recentPhotos()}
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
    const { bills } = data;
    const s = summarize(bills, store);
    let settle = '';
    if (!bills.length) {
      settle = '<p class="settle-note">タップして今月の家計簿を開きましょう。</p>';
    } else if (s.allSettled) {
      settle = `<p class="home-status ok">${icon('checkCircle', 18)}すべて精算済み</p>`;
    } else if (s.rows && s.pending.length && s.amount > 0) {
      settle = settleResultHtml(s.debtor, s.creditor, s.amount);
    } else if (s.unpaid > 0) {
      settle = `<p class="home-status">${icon('circle', 18)}未払いが${s.unpaid}件あります</p>`;
    }
    return `
      <button class="card total home-month" data-go="money">
        <div class="total-row">
          <div>
            <p class="label">${monthLabel(month)}の家計簿</p>
            <p class="big">${yen(s.total)}</p>
          </div>
          <span class="muted">${icon('chevronRight', 22)}</span>
        </div>
        <div class="progress"><span style="width:${s.pct}%"></span></div>
        <p class="label">${s.paidBills.length} / ${bills.length} 件 支払済み</p>
        ${settle}
      </button>`;
  }

  function upcomingBills() {
    const list = data.bills.filter((b) => !b.paid)
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
      .slice(0, 4);
    if (!list.length) return '';
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

  function nextEvents() {
    if (!data.events?.length) return '';
    return `
      <h2 class="section-title">これからの予定</h2>
      <div class="card upcoming">
        ${data.events.map((ev) => `
          <button class="upcoming-row" data-go="calendar">
            <span class="date-badge ${ev.date === today ? 'today' : ''}">
              <small>${Number(ev.date.slice(5, 7))}月</small>${Number(ev.date.slice(8, 10))}
            </span>
            <span class="bill-main">
              <span class="bill-name">${esc(ev.title)}</span>
              <span class="bill-meta"><span>${ev.date === today ? '今日 ' : dayLabel(ev.date).replace(/^\d+月\d+日/, '')}${timeLabel(ev)}</span>
              ${ev.place ? `<span>${icon('mapPin', 13)}${esc(ev.place)}</span>` : ''}</span>
            </span>
          </button>`).join('')}
      </div>`;
  }

  function todoList() {
    if (!data.todos) return '';
    const open = sortTodos(data.todos.filter((t) => !t.done)).slice(0, 4);
    if (!open.length) return '';
    return `
      <h2 class="section-title">やること</h2>
      <div class="card upcoming">
        ${open.map((t) => {
          const who = t.assignee ? store.member(t.assignee) : null;
          const overdue = t.due && t.due < today;
          return `
            <button class="upcoming-row" data-go="todo">
              <span class="muted">${icon('circle', 20)}</span>
              <span class="bill-main">
                <span class="bill-name">${esc(t.text)}</span>
                <span class="bill-meta">
                  ${who ? `<span class="who tone-${who.tone}">${esc(who.name)}</span>` : '<span class="who both">2人</span>'}
                  ${t.due ? `<span class="${overdue ? 'overdue' : ''}">${icon('calendar', 13)}${Number(t.due.slice(5, 7))}/${Number(t.due.slice(8, 10))}</span>` : ''}
                </span>
              </span>
            </button>`;
        }).join('')}
      </div>`;
  }

  function shopping() {
    if (!data.shopping) return '';
    const todo = data.shopping.filter((i) => !i.done);
    if (!todo.length) return '';
    return `
      <h2 class="section-title">買い物リスト</h2>
      <button class="card shop-summary" data-go="shopping">
        <span class="menu-icon">${icon('cart', 22)}</span>
        <span class="bill-main">
          <span class="bill-name">${todo.length}件</span>
          <span class="bill-note">${todo.slice(0, 5).map((i) => esc(i.text)).join('、')}</span>
        </span>
        <span class="muted">${icon('chevronRight', 20)}</span>
      </button>`;
  }

  function recentPhotos() {
    if (!data.photos?.length) return '';
    return `
      <h2 class="section-title">最近の写真</h2>
      <button class="photo-strip" data-go="photos">
        ${data.photos.map((p) => `<img src="${p.thumb}" alt="">`).join('')}
      </button>`;
  }

  const set = (key) => (snap) => {
    data[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (key === 'events') sortEvents(data.events);
    render();
  };
  const onErr = (err) => toast(`読み込みに失敗しました (${err.code})`);
  const unsubs = [
    onSnapshot(col('months', month, 'bills'), set('bills'), onErr),
    onSnapshot(query(col('events'), where('date', '>=', today), orderBy('date'), limit(3)), set('events'), onErr),
    onSnapshot(col('shopping'), set('shopping'), onErr),
    onSnapshot(col('todos'), set('todos'), onErr),
    onSnapshot(query(col('photos'), orderBy('createdMs', 'desc'), limit(4)), set('photos'), onErr),
    store.subscribe(render),
  ];
  render();
  return () => unsubs.forEach((u) => u());
}
