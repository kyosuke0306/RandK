import {
  col, ref, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  writeBatch, serverTimestamp,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, yen, monthKey, todayStr, shiftMonth, monthLabel, toast, h } from '../util.js';

export const CATEGORIES = [
  { id: 'rent', label: '家賃', icon: 'home' },
  { id: 'electricity', label: '電気', icon: 'bolt' },
  { id: 'gas', label: 'ガス', icon: 'flame' },
  { id: 'water', label: '水道', icon: 'droplet' },
  { id: 'internet', label: 'ネット', icon: 'wifi' },
  { id: 'phone', label: '通信', icon: 'phone' },
  { id: 'other', label: 'その他', icon: 'receipt' },
];
const cat = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1);
const PRESETS = ['rent', 'electricity', 'gas', 'water', 'internet'];

export function shareFor(store, uid) {
  const members = store.memberList();
  const shares = store.settings.shares || {};
  if (members.length < 2) return 100;
  const other = members.find((m) => m.uid !== uid);
  if (shares[uid] != null) return shares[uid];
  if (other && shares[other.uid] != null) return 100 - shares[other.uid];
  return 50;
}

// 合計・支払状況・精算額をまとめて計算する（トップ画面でも使う）
export function summarize(bills, store) {
  const sum = (list) => list.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const total = sum(bills);
  const paidBills = bills.filter((b) => b.paid);
  const paidTotal = sum(paidBills);
  const pct = total ? Math.round((paidTotal / total) * 100) : 0;
  const unpaid = bills.length - paidBills.length;
  const members = store.memberList();
  const result = { total, paidBills, paidTotal, pct, unpaid, members };
  if (members.length !== 2 || !bills.length) return result;

  const rows = members.map((m) => {
    const paid = sum(paidBills.filter((b) => b.payer === m.uid));
    const burden = Math.round(total * shareFor(store, m.uid) / 100);
    return { ...m, paid, burden, diff: paid - burden };
  });
  const [x, y] = rows;
  const creditor = x.diff >= y.diff ? x : y;
  const debtor = creditor === x ? y : x;
  const amount = Math.round((creditor.diff - debtor.diff) / 2);
  return { ...result, rows, creditor, debtor, amount };
}

export function settleResultHtml(debtor, creditor, amount) {
  return `
    <div class="settle-result">
      <span class="who tone-${debtor.tone}">${esc(debtor.name)}</span>
      ${icon('arrowRight', 18, 'muted')}
      <span class="who tone-${creditor.tone}">${esc(creditor.name)}</span>
      <strong>${yen(amount)}</strong>
    </div>`;
}

export function mount(el, { store, db }) {
  let month = sessionStorage.getItem('month') || monthKey();
  let bills = [];
  let monthMeta = {};
  let unsubMonth = [];
  let gotBills = false;

  el.innerHTML = `
    <header class="month-bar">
      <button class="icon-btn" data-act="prev" aria-label="前の月">${icon('chevronLeft')}</button>
      <button class="month-title" data-act="today"></button>
      <button class="icon-btn" data-act="next" aria-label="次の月">${icon('chevronRight')}</button>
    </header>
    <section id="summary"></section>
    <section id="list" class="bill-list"></section>
    <button class="fab" data-act="add" aria-label="追加">${icon('plus', 26)}</button>`;

  const $summary = el.querySelector('#summary');
  const $list = el.querySelector('#list');

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'prev') setMonth(shiftMonth(month, -1));
    if (act === 'next') setMonth(shiftMonth(month, 1));
    if (act === 'today') setMonth(monthKey());
    if (act === 'add') openEditor();
    if (act === 'edit') openEditor(bills.find((b) => b.id === t.dataset.id));
    if (act === 'toggle') togglePaid(bills.find((b) => b.id === t.dataset.id));
    if (act === 'copy') copyPrevMonth();
    if (act === 'presets') addPresets();
    if (act === 'settle') toggleSettled();
  });

  const billsRef = () => col('months', month, 'bills');
  const monthRef = () => ref('months', month);

  function setMonth(key) {
    month = key;
    sessionStorage.setItem('month', key);
    listen();
  }

  // 選択中の月のデータをリアルタイム購読（相手の変更も即座に反映される）
  function listen() {
    unsubMonth.forEach((u) => u());
    bills = [];
    monthMeta = {};
    el.querySelector('.month-title').textContent = monthLabel(month);
    $list.innerHTML = '<div class="spinner small"></div>';
    $summary.innerHTML = '';
    gotBills = false;
    unsubMonth = [
      onSnapshot(billsRef(), (snap) => {
        gotBills = true;
        bills = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.order ?? 99) - (b.order ?? 99)
            || CATEGORIES.indexOf(cat(a.category)) - CATEGORIES.indexOf(cat(b.category))
            || (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        render();
      }, (e) => toast(`読み込みに失敗しました (${e.code})`)),
      onSnapshot(monthRef(), (snap) => {
        monthMeta = snap.data() || {};
        render();
      }),
    ];
  }

  function render() {
    if (!gotBills) return;
    renderSummary();
    renderList();
  }

  function renderSummary() {
    const {
      total, paidBills, paidTotal, pct, members, rows, unpaid, debtor, creditor, amount,
    } = summarize(bills, store);
    const shareOf = (uid) => shareFor(store, uid);

    let settleHtml = '';
    if (rows) {
      let result;
      if (unpaid > 0) {
        result = `<p class="settle-note">未払いが${unpaid}件あります。すべて支払うと精算額が確定します。</p>`;
      } else if (amount === 0) {
        result = '<p class="settle-result">精算の必要はありません</p>';
      } else {
        result = settleResultHtml(debtor, creditor, amount);
      }
      settleHtml = `
        <div class="card settle ${monthMeta.settled ? 'is-settled' : ''}">
          <div class="card-head">
            <h2>精算</h2>
            <button class="chip ${monthMeta.settled ? 'chip-ok' : ''}" data-act="settle">
              ${icon(monthMeta.settled ? 'checkCircle' : 'circle', 16)}
              ${monthMeta.settled ? '精算済み' : '未精算'}
            </button>
          </div>
          <table class="settle-table">
            <thead><tr><th></th><th>立て替え</th><th>負担分</th></tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td><span class="dot tone-${r.tone}"></span>${esc(r.name)} <small class="muted">${shareOf(r.uid)}%</small></td>
                  <td>${yen(r.paid)}</td>
                  <td>${yen(r.burden)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
          ${result}
        </div>`;
    } else if (members.length < 2) {
      settleHtml = `
        <div class="card hint">
          ${icon('users', 20)}
          <p>パートナーが一度ログインすると、2人で共有・精算できるようになります。</p>
        </div>`;
    }

    $summary.innerHTML = `
      <div class="card total">
        <div class="total-row">
          <div>
            <p class="label">今月の合計</p>
            <p class="big">${yen(total)}</p>
          </div>
          <div class="right">
            <p class="label">支払済み</p>
            <p>${yen(paidTotal)}</p>
          </div>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${pct}%"></span>
        </div>
        <p class="label">${paidBills.length} / ${bills.length} 件 支払済み</p>
      </div>
      ${settleHtml}`;
  }

  function renderList() {
    if (!bills.length) {
      $list.innerHTML = `
        <div class="empty">
          ${icon('receipt', 40, 'muted')}
          <p>${monthLabel(month)}の項目はまだありません</p>
          <div class="empty-actions">
            <button class="btn" data-act="copy">${icon('copy', 18)}<span>先月からコピー</span></button>
            <button class="btn btn-ghost" data-act="presets">${icon('plus', 18)}<span>家賃・光熱費をまとめて追加</span></button>
          </div>
        </div>`;
      return;
    }
    $list.innerHTML = bills.map((b) => {
      const c = cat(b.category);
      const payer = b.payer ? store.member(b.payer) : null;
      const due = b.dueDate ? `${Number(b.dueDate.slice(5, 7))}/${Number(b.dueDate.slice(8, 10))}` : '';
      const overdue = !b.paid && b.dueDate && b.dueDate < todayStr();
      const meta = [
        due && `<span class="${overdue ? 'overdue' : ''}">${icon('calendar', 13)}${due}${overdue ? ' 期限切れ' : ''}</span>`,
        payer && `<span class="who tone-${payer.tone}">${esc(payer.name)}${b.paid ? 'が支払い' : 'が払う'}</span>`,
      ].filter(Boolean).join('');
      return `
        <article class="bill ${b.paid ? 'paid' : ''}">
          <button class="check" data-act="toggle" data-id="${b.id}" aria-label="${b.paid ? '未払いに戻す' : '支払済みにする'}">
            ${icon(b.paid ? 'check' : 'circle', 20)}
          </button>
          <button class="bill-body" data-act="edit" data-id="${b.id}">
            <span class="cat-icon cat-${c.id}">${icon(c.icon, 20)}</span>
            <span class="bill-main">
              <span class="bill-name">${esc(b.name || c.label)}</span>
              <span class="bill-meta">${meta}</span>
              ${b.note ? `<span class="bill-note">${esc(b.note)}</span>` : ''}
            </span>
            <span class="bill-amount">${b.amount ? yen(b.amount) : '<span class="muted">未入力</span>'}</span>
          </button>
        </article>`;
    }).join('') + (bills.length ? `<p class="updated muted">${lastUpdated()}</p>` : '');
  }

  function lastUpdated() {
    const latest = bills.filter((b) => b.updatedAt)
      .sort((a, b) => b.updatedAt.seconds - a.updatedAt.seconds)[0];
    if (!latest) return '';
    const d = latest.updatedAt.toDate();
    return `最終更新: ${store.name(latest.updatedBy)}（${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}）`;
  }

  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: store.user.uid });

  async function togglePaid(b) {
    if (!b) return;
    const paid = !b.paid;
    await updateDoc(doc(billsRef(), b.id), {
      paid,
      payer: paid && !b.payer ? store.user.uid : b.payer || null,
      paidAt: paid ? serverTimestamp() : null,
      ...stamp(),
    }).catch((e) => toast(`更新に失敗しました (${e.code})`));
  }

  async function toggleSettled() {
    await setDoc(monthRef(), { settled: !monthMeta.settled, ...stamp() }, { merge: true })
      .catch((e) => toast(`更新に失敗しました (${e.code})`));
  }

  async function addPresets() {
    const batch = writeBatch(db);
    PRESETS.forEach((id, i) => {
      batch.set(doc(billsRef()), {
        category: id, name: cat(id).label, amount: null, paid: false,
        payer: null, dueDate: null, note: '', order: i,
        createdAt: serverTimestamp(), ...stamp(),
      });
    });
    await batch.commit().catch((e) => toast(`追加に失敗しました (${e.code})`));
  }

  async function copyPrevMonth() {
    const prev = shiftMonth(month, -1);
    const snap = await getDocs(col('months', prev, 'bills'));
    if (snap.empty) return toast(`${monthLabel(prev)}の項目がありません`);
    const batch = writeBatch(db);
    snap.docs.forEach((d, i) => {
      const b = d.data();
      let dueDate = null;
      if (b.dueDate) {
        const day = Number(b.dueDate.slice(8, 10));
        const [y, m] = month.split('-').map(Number);
        const last = new Date(y, m, 0).getDate();
        dueDate = `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
      }
      batch.set(doc(billsRef()), {
        category: b.category, name: b.name, note: b.note || '',
        // 家賃など毎月同じ金額は引き継ぎ、変動する光熱費は空にする
        amount: b.category === 'rent' || b.category === 'internet' ? b.amount ?? null : null,
        paid: false, payer: b.payer || null, dueDate, order: b.order ?? i,
        createdAt: serverTimestamp(), ...stamp(),
      });
    });
    await batch.commit().catch((e) => toast(`コピーに失敗しました (${e.code})`));
    toast(`${monthLabel(prev)}からコピーしました`);
  }

  function openEditor(bill) {
    const isNew = !bill;
    const b = bill || { category: 'electricity', paid: false, payer: null };
    const members = store.memberList();
    const dlg = h(`
      <dialog class="sheet">
        <form method="dialog">
          <header class="sheet-head">
            <h2>${isNew ? '項目を追加' : '項目を編集'}</h2>
            <button type="button" class="icon-btn" data-close aria-label="閉じる">${icon('close')}</button>
          </header>
          <div class="cat-picker">
            ${CATEGORIES.map((c) => `
              <label class="cat-option">
                <input type="radio" name="category" value="${c.id}" ${c.id === cat(b.category).id ? 'checked' : ''}>
                <span class="cat-icon cat-${c.id}">${icon(c.icon, 20)}</span>
                <span>${c.label}</span>
              </label>`).join('')}
          </div>
          <label class="field">
            <span>名前</span>
            <input name="name" value="${esc(b.name || '')}" placeholder="${esc(cat(b.category).label)}" maxlength="40">
          </label>
          <div class="field-row">
            <label class="field">
              <span>金額（円）</span>
              <input name="amount" type="number" inputmode="numeric" min="0" step="1" value="${b.amount ?? ''}" placeholder="0">
            </label>
            <label class="field">
              <span>支払期限</span>
              <input name="dueDate" type="date" value="${b.dueDate || ''}">
            </label>
          </div>
          <fieldset class="field">
            <span>支払う人</span>
            <div class="segmented">
              <label><input type="radio" name="payer" value="" ${!b.payer ? 'checked' : ''}><span>未定</span></label>
              ${members.map((m) => `
                <label><input type="radio" name="payer" value="${m.uid}" ${b.payer === m.uid ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}
            </div>
          </fieldset>
          <label class="switch-row">
            <span>支払済み</span>
            <input type="checkbox" name="paid" class="switch" ${b.paid ? 'checked' : ''}>
          </label>
          <label class="field">
            <span>メモ</span>
            <input name="note" value="${esc(b.note || '')}" maxlength="100" placeholder="検針日、口座振替など">
          </label>
          <footer class="sheet-foot">
            ${isNew ? '' : `<button type="button" class="btn btn-danger" data-delete>${icon('trash', 18)}<span>削除</span></button>`}
            <button type="submit" class="btn btn-primary">${icon('check', 18)}<span>保存</span></button>
          </footer>
        </form>
      </dialog>`);
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const nameInput = form.elements.name;

    form.addEventListener('change', (e) => {
      if (e.target.name === 'category') nameInput.placeholder = cat(e.target.value).label;
    });
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

    dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!confirm(`「${b.name || cat(b.category).label}」を削除しますか？`)) return;
      dlg.close();
      await deleteDoc(doc(billsRef(), b.id)).catch((e) => toast(`削除に失敗しました (${e.code})`));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const category = f.category.value;
      const paid = f.paid.checked;
      const data = {
        category,
        name: f.name.value.trim() || cat(category).label,
        amount: f.amount.value === '' ? null : Math.round(Number(f.amount.value)),
        dueDate: f.dueDate.value || null,
        payer: f.payer.value || (paid ? store.user.uid : null),
        paid,
        note: f.note.value.trim(),
        ...stamp(),
      };
      if (paid && !b.paid) data.paidAt = serverTimestamp();
      if (!paid) data.paidAt = null;
      dlg.close();
      try {
        if (isNew) await addDoc(billsRef(), { ...data, createdAt: serverTimestamp() });
        else await updateDoc(doc(billsRef(), b.id), data);
      } catch (err) {
        toast(`保存に失敗しました (${err.code})`);
      }
    });

    dlg.showModal();
  }

  const unsubStore = store.subscribe(render);
  listen();

  return () => {
    unsubMonth.forEach((u) => u());
    unsubStore();
    document.querySelectorAll('dialog.sheet').forEach((d) => d.remove());
  };
}
