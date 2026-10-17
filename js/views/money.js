import {
  db, col, ref, doc, onSnapshot, updateDoc, deleteDoc, addDoc, getDocs,
  writeBatch, runTransaction, serverTimestamp,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, yen, monthKey, todayStr, shiftMonth, monthLabel, toast, h } from '../util.js';

export const CATEGORIES = [
  { id: 'rent', label: '家賃', icon: 'home' },
  { id: 'electricity', label: '電気代', icon: 'bolt' },
  { id: 'gas', label: 'ガス代', icon: 'flame' },
  { id: 'water', label: '水道代', icon: 'droplet' },
  { id: 'internet', label: 'ネット', icon: 'wifi' },
  { id: 'phone', label: '通信', icon: 'phone' },
  { id: 'other', label: 'その他', icon: 'receipt' },
];
// 毎月かならず用意する項目
const FIXED = ['rent', 'electricity', 'gas', 'water'];
// 先月から金額を引き継ぐ項目（毎月同じ金額のもの）
const CARRY_AMOUNT = ['rent', 'internet'];

export const cat = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1);
const catIndex = (id) => CATEGORIES.indexOf(cat(id));

export function shareFor(store, uid) {
  const members = store.memberList();
  const shares = store.settings.shares || {};
  if (members.length < 2) return 100;
  const other = members.find((m) => m.uid !== uid);
  if (shares[uid] != null) return shares[uid];
  if (other && shares[other.uid] != null) return 100 - shares[other.uid];
  return 50;
}

// 1件の金額を2人の負担割合で分ける
export function splitBill(store, amount) {
  return store.memberList().map((m) => ({
    ...m, amount: Math.round((Number(amount) || 0) * shareFor(store, m.uid) / 100),
  }));
}

export const isEvenSplit = (store) => store.memberList().every((m) => shareFor(store, m.uid) === 50);

// 合計・支払状況・精算額をまとめて計算する（トップ画面でも使う）
export function summarize(bills, store) {
  const sum = (list) => list.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const total = sum(bills);
  const paidBills = bills.filter((b) => b.paid);
  const paidTotal = sum(paidBills);
  const pct = total ? Math.round((paidTotal / total) * 100) : 0;
  const unpaid = bills.length - paidBills.length;
  // 支払済みでまだ精算していないもの
  const pending = paidBills.filter((b) => !b.settled && b.payer && Number(b.amount));
  const allSettled = bills.length > 0 && bills.every((b) => b.settled);
  const members = store.memberList();
  const result = { total, paidBills, paidTotal, pct, unpaid, pending, allSettled, members };
  if (members.length !== 2) return result;

  const rows = members.map((m) => ({
    ...m,
    share: shareFor(store, m.uid),
    paid: sum(paidBills.filter((b) => b.payer === m.uid)),
    burden: Math.round(total * shareFor(store, m.uid) / 100),
  }));
  // 立て替えた人は、相手の負担分を受け取る
  const credit = Object.fromEntries(members.map((m) => [m.uid, 0]));
  pending.forEach((b) => {
    const other = members.find((m) => m.uid !== b.payer);
    if (other && credit[b.payer] != null) credit[b.payer] += Number(b.amount) * shareFor(store, other.uid) / 100;
  });
  const [x, y] = members;
  const diff = Math.round(credit[x.uid] - credit[y.uid]);
  const creditor = rows.find((r) => r.uid === (diff >= 0 ? x.uid : y.uid));
  const debtor = rows.find((r) => r !== creditor);
  return { ...result, rows, creditor, debtor, amount: Math.abs(diff) };
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

const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// その月の項目を用意する。家賃・電気代・ガス代・水道代は必ず作り、先月の項目も引き継ぐ。
// 2人が同時に開いても二重に作られないよう、トランザクションで1回だけ実行する。
async function setupMonth(month, store) {
  const prevSnap = await getDocs(col('months', shiftMonth(month, -1), 'bills'));
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const items = {};
  prevSnap.docs.forEach((d) => {
    const b = d.data();
    const id = FIXED.includes(b.category) && !items[b.category] ? b.category : d.id;
    const day = b.dueDate ? Math.min(Number(b.dueDate.slice(8, 10)), lastDay) : null;
    items[id] = {
      category: b.category,
      name: b.name || cat(b.category).label,
      amount: CARRY_AMOUNT.includes(b.category) ? b.amount ?? null : null,
      payer: b.payer || null,
      dueDate: day ? `${month}-${String(day).padStart(2, '0')}` : null,
      note: '',
      order: b.order ?? catIndex(b.category),
    };
  });
  FIXED.forEach((c) => {
    items[c] ??= {
      category: c, name: cat(c).label, amount: null, payer: null, dueDate: null, note: '', order: catIndex(c),
    };
  });

  await runTransaction(db, async (tx) => {
    const monthRef = ref('months', month);
    const meta = await tx.get(monthRef);
    if (meta.data()?.initialized) return;
    tx.set(monthRef, { initialized: true }, { merge: true });
    Object.entries(items).forEach(([id, data]) => {
      tx.set(ref('months', month, 'bills', id), {
        ...data, paid: false, settled: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: store.user.uid,
      });
    });
  });
}

export function mount(el, { store }) {
  let month = sessionStorage.getItem('month') || monthKey();
  let bills = [];
  let monthMeta = {};
  let unsubMonth = [];
  let loaded = { bills: false, meta: false };

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
    const bill = bills.find((b) => b.id === t.dataset.id);
    if (act === 'prev') setMonth(shiftMonth(month, -1));
    if (act === 'next') setMonth(shiftMonth(month, 1));
    if (act === 'today') setMonth(monthKey());
    if (act === 'add') openEditor();
    if (act === 'edit') openEditor(bill);
    if (act === 'toggle') togglePaid(bill);
    if (act === 'setup') setupMonth(month, store).catch((err) => toast(`作成に失敗しました (${err.code})`));
    if (act === 'settle-all') settleAll();
  });

  const billsRef = () => col('months', month, 'bills');
  const billRef = (id) => doc(billsRef(), id);

  function setMonth(key) {
    month = key;
    sessionStorage.setItem('month', key);
    listen();
  }

  // 今月と来月は、開いたときに項目を自動で用意する
  function maybeSetup() {
    if (!loaded.bills || !loaded.meta || bills.length || monthMeta.initialized) return;
    const now = monthKey();
    if (month < now || month > shiftMonth(now, 1)) return;
    setupMonth(month, store).catch((err) => toast(`項目の作成に失敗しました (${err.code})`));
  }

  // 選択中の月のデータをリアルタイム購読（相手の変更も即座に反映される）
  function listen() {
    unsubMonth.forEach((u) => u());
    bills = [];
    monthMeta = {};
    loaded = { bills: false, meta: false };
    el.querySelector('.month-title').textContent = monthLabel(month);
    $list.innerHTML = '<div class="spinner small"></div>';
    $summary.innerHTML = '';
    const opts = { includeMetadataChanges: true };
    unsubMonth = [
      onSnapshot(billsRef(), opts, (snap) => {
        bills = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.order ?? 99) - (b.order ?? 99)
            || catIndex(a.category) - catIndex(b.category)
            || (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        // キャッシュだけの結果では「空」と判断しない
        if (!snap.metadata.fromCache) loaded.bills = true;
        render();
        maybeSetup();
      }, (err) => toast(`読み込みに失敗しました (${err.code})`)),
      onSnapshot(ref('months', month), opts, (snap) => {
        monthMeta = snap.data() || {};
        if (!snap.metadata.fromCache) loaded.meta = true;
        maybeSetup();
      }),
    ];
  }

  function render() {
    if (!bills.length && !loaded.bills) return;
    renderSummary();
    renderList();
  }

  function renderSummary() {
    const s = summarize(bills, store);
    let settleHtml = '';
    if (s.rows && bills.length) {
      let result;
      if (s.pending.length) {
        result = `
          ${s.amount > 0 ? settleResultHtml(s.debtor, s.creditor, s.amount) : '<p class="settle-result">貸し借りはありません</p>'}
          <div class="settle-actions">
            <span class="label">未精算 ${s.pending.length}件${s.unpaid ? `（未払い${s.unpaid}件は含みません）` : ''}</span>
            <button class="btn btn-small" data-act="settle-all">${icon('check', 16)}<span>精算済みにする</span></button>
          </div>`;
      } else if (s.allSettled) {
        result = `<p class="home-status ok">${icon('checkCircle', 18)}この月はすべて精算済み</p>`;
      } else {
        result = `<p class="settle-note">支払済みにすると、ここに精算額が出ます。</p>`;
      }
      settleHtml = `
        <div class="card settle">
          <div class="card-head">
            <h2>2人で割ると</h2>
            ${isEvenSplit(store) && s.total ? `<span class="per-person">1人 <strong>${yen(s.total / 2)}</strong></span>` : ''}
          </div>
          <table class="settle-table">
            <thead><tr><th></th><th>支払った額</th><th>負担額</th></tr></thead>
            <tbody>
              ${s.rows.map((r) => `
                <tr>
                  <td><span class="dot tone-${r.tone}"></span>${esc(r.name)} <small class="muted">${r.share}%</small></td>
                  <td>${yen(r.paid)}</td>
                  <td>${yen(r.burden)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
          ${result}
        </div>`;
    } else if (s.members.length < 2) {
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
            <p class="label">${monthLabel(month)}の合計</p>
            <p class="big">${yen(s.total)}</p>
          </div>
          <div class="right">
            <p class="label">支払済み</p>
            <p>${yen(s.paidTotal)}</p>
          </div>
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${s.pct}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${s.pct}%"></span>
        </div>
        <p class="label">${s.paidBills.length} / ${bills.length} 件 支払済み</p>
      </div>
      ${settleHtml}`;
  }

  function splitText(amount) {
    if (store.memberList().length < 2 || !amount) return '';
    if (isEvenSplit(store)) return `1人 ${yen(amount / 2)}`;
    return splitBill(store, amount).map((p) => `${esc(p.name)} ${yen(p.amount)}`).join(' / ');
  }

  function statusChip(b) {
    if (b.settled) return `<span class="status settled">${icon('checkCircle', 13)}精算済み</span>`;
    if (b.paid) {
      const payer = store.member(b.payer);
      return payer
        ? `<span class="who tone-${payer.tone}">${esc(payer.name)}が支払い</span>`
        : '<span class="status paid">支払済み</span>';
    }
    const payer = b.payer ? store.member(b.payer) : null;
    return `<span class="status unpaid">未払い</span>${payer ? `<span class="muted">${esc(payer.name)}が払う</span>` : ''}`;
  }

  function renderList() {
    if (!bills.length) {
      $list.innerHTML = `
        <div class="empty">
          ${icon('receipt', 40, 'muted')}
          <p>${monthLabel(month)}の項目はまだありません</p>
          <div class="empty-actions">
            <button class="btn" data-act="setup">${icon('plus', 18)}<span>家賃・電気代・ガス代・水道代を作る</span></button>
          </div>
        </div>`;
      return;
    }
    const today = todayStr();
    $list.innerHTML = bills.map((b) => {
      const c = cat(b.category);
      const overdue = !b.paid && b.dueDate && b.dueDate < today;
      const meta = [
        statusChip(b),
        b.dueDate && `<span class="${overdue ? 'overdue' : ''}">${icon('calendar', 13)}${shortDate(b.dueDate)}${overdue ? ' 期限切れ' : ''}</span>`,
      ].filter(Boolean).join('');
      const split = splitText(b.amount);
      return `
        <article class="bill ${b.paid ? 'paid' : ''} ${b.settled ? 'settled' : ''}">
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
            <span class="bill-amount">
              ${b.amount ? yen(b.amount) : '<span class="muted">金額を入力</span>'}
              ${split ? `<small>${split}</small>` : ''}
            </span>
          </button>
        </article>`;
    }).join('') + `<p class="updated muted">${lastUpdated()}</p>`;
  }

  function lastUpdated() {
    const latest = bills.filter((b) => b.updatedAt)
      .sort((a, b) => b.updatedAt.seconds - a.updatedAt.seconds)[0];
    if (!latest) return '';
    const d = latest.updatedAt.toDate();
    return `最終更新: ${esc(store.name(latest.updatedBy))}（${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}）`;
  }

  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: store.user.uid });

  async function togglePaid(b) {
    if (!b) return;
    const paid = !b.paid;
    if (!paid && b.settled && !confirm('精算済みの項目です。未払いに戻しますか？')) return;
    await updateDoc(billRef(b.id), {
      paid,
      payer: paid && !b.payer ? store.user.uid : b.payer || null,
      paidAt: paid ? serverTimestamp() : null,
      ...(paid ? {} : { settled: false, settledAt: null }),
      ...stamp(),
    }).catch((err) => toast(`更新に失敗しました (${err.code})`));
  }

  async function settleAll() {
    const s = summarize(bills, store);
    if (!s.pending.length) return;
    const msg = s.amount > 0
      ? `${s.debtor.name}から${s.creditor.name}へ ${yen(s.amount)} 渡しましたか？\n${s.pending.length}件を精算済みにします。`
      : `${s.pending.length}件を精算済みにします。`;
    if (!confirm(msg)) return;
    const batch = writeBatch(db);
    s.pending.forEach((b) => batch.update(billRef(b.id), { settled: true, settledAt: serverTimestamp(), ...stamp() }));
    await batch.commit()
      .then(() => toast('精算済みにしました'))
      .catch((err) => toast(`更新に失敗しました (${err.code})`));
  }

  function openEditor(bill) {
    const isNew = !bill;
    const b = bill || { category: 'other', paid: false, settled: false, payer: null };
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
          <p class="split-preview label"></p>
          <fieldset class="field">
            <span>支払う人・支払った人</span>
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
          <label class="switch-row">
            <span>精算済み <small class="muted">2人の間でお金を渡し終えた</small></span>
            <input type="checkbox" name="settled" class="switch" ${b.settled ? 'checked' : ''}>
          </label>
          <label class="field">
            <span>メモ</span>
            <input name="note" value="${esc(b.note || '')}" maxlength="100" placeholder="検針期間、口座振替など">
          </label>
          <footer class="sheet-foot">
            ${isNew ? '' : `<button type="button" class="btn btn-danger" data-delete>${icon('trash', 18)}<span>削除</span></button>`}
            <button type="submit" class="btn btn-primary">${icon('check', 18)}<span>保存</span></button>
          </footer>
        </form>
      </dialog>`);
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const f = form.elements;
    const $split = form.querySelector('.split-preview');
    const updateSplit = () => {
      const text = splitText(Number(f.amount.value));
      $split.textContent = text ? `2人で割ると ${text}` : '';
    };
    updateSplit();

    form.addEventListener('input', (e) => { if (e.target.name === 'amount') updateSplit(); });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'category') f.name.placeholder = cat(e.target.value).label;
      // 精算済みなら支払済みでもある
      if (e.target.name === 'settled' && f.settled.checked) f.paid.checked = true;
      if (e.target.name === 'paid' && !f.paid.checked) f.settled.checked = false;
    });
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

    dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!confirm(`「${b.name || cat(b.category).label}」を削除しますか？`)) return;
      dlg.close();
      await deleteDoc(billRef(b.id)).catch((err) => toast(`削除に失敗しました (${err.code})`));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const category = f.category.value;
      const paid = f.paid.checked;
      const settled = paid && f.settled.checked;
      const data = {
        category,
        name: f.name.value.trim() || cat(category).label,
        amount: f.amount.value === '' ? null : Math.round(Number(f.amount.value)),
        dueDate: f.dueDate.value || null,
        payer: f.payer.value || (paid ? store.user.uid : null),
        paid,
        settled,
        note: f.note.value.trim(),
        ...stamp(),
      };
      if (paid && !b.paid) data.paidAt = serverTimestamp();
      if (!paid) data.paidAt = null;
      if (settled && !b.settled) data.settledAt = serverTimestamp();
      if (!settled) data.settledAt = null;
      dlg.close();
      try {
        if (isNew) await addDoc(billsRef(), { ...data, order: catIndex(category), createdAt: serverTimestamp() });
        else await updateDoc(billRef(b.id), data);
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
