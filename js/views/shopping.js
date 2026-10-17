import {
  col, doc, onSnapshot, addDoc, updateDoc, deleteDoc, writeBatch, db, serverTimestamp,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, toast } from '../util.js';

export function mount(el, { store }) {
  let items = null;
  const itemsRef = col('shopping');
  const itemRef = (id) => doc(itemsRef, id);

  el.innerHTML = `
    <header class="page-head"><h1>買い物リスト</h1></header>
    <form class="add-row" id="add">
      <input name="text" placeholder="買うものを入力" maxlength="60" autocomplete="off" enterkeyhint="done">
      <button class="btn btn-primary" aria-label="追加">${icon('plus', 20)}</button>
    </form>
    <section id="list"></section>`;
  const $list = el.querySelector('#list');
  const form = el.querySelector('#add');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    form.elements.text.value = '';
    await addDoc(itemsRef, {
      text, done: false, createdBy: store.user.uid, createdAt: serverTimestamp(), createdMs: Date.now(),
    }).catch((err) => toast(`追加に失敗しました (${err.code})`));
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const item = items?.find((i) => i.id === t.dataset.id);
    if (t.dataset.act === 'toggle' && item) {
      await updateDoc(itemRef(item.id), {
        done: !item.done, doneBy: item.done ? null : store.user.uid, doneMs: item.done ? null : Date.now(),
      }).catch((err) => toast(`更新に失敗しました (${err.code})`));
    }
    if (t.dataset.act === 'delete' && item) {
      await deleteDoc(itemRef(item.id)).catch((err) => toast(`削除に失敗しました (${err.code})`));
    }
    if (t.dataset.act === 'clear') {
      const done = items.filter((i) => i.done);
      if (!confirm(`買ったもの${done.length}件をリストから消しますか？`)) return;
      const batch = writeBatch(db);
      done.forEach((i) => batch.delete(itemRef(i.id)));
      await batch.commit().catch((err) => toast(`削除に失敗しました (${err.code})`));
    }
  });

  const row = (i) => {
    const by = store.member(i.createdBy);
    return `
      <li class="shop-item ${i.done ? 'done' : ''}">
        <button class="check" data-act="toggle" data-id="${i.id}" aria-label="${i.done ? '未購入に戻す' : '買った'}">
          ${icon(i.done ? 'check' : 'circle', 20)}
        </button>
        <span class="shop-text">
          ${esc(i.text)}
          ${by ? `<span class="dot tone-${by.tone}" title="${esc(by.name)}が追加"></span>` : ''}
        </span>
        <button class="icon-btn small" data-act="delete" data-id="${i.id}" aria-label="削除">${icon('close', 18)}</button>
      </li>`;
  };

  function render() {
    if (!items) return;
    const todo = items.filter((i) => !i.done).sort((a, b) => (b.createdMs || 0) - (a.createdMs || 0));
    const done = items.filter((i) => i.done).sort((a, b) => (b.doneMs || 0) - (a.doneMs || 0));
    if (!items.length) {
      $list.innerHTML = `
        <div class="empty">
          ${icon('cart', 40, 'muted')}
          <p>買うものはありません</p>
        </div>`;
      return;
    }
    $list.innerHTML = `
      ${todo.length ? `<ul class="card shop-list">${todo.map(row).join('')}</ul>`
        : `<p class="empty-line">${icon('checkCircle', 18)}全部買いました</p>`}
      ${done.length ? `
        <div class="section-row">
          <h2 class="section-title">買ったもの（${done.length}）</h2>
          <button class="btn btn-ghost btn-small" data-act="clear">${icon('trash', 16)}<span>まとめて消す</span></button>
        </div>
        <ul class="card shop-list">${done.map(row).join('')}</ul>` : ''}`;
  }

  const unsubs = [
    onSnapshot(itemsRef, (snap) => {
      items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (err) => toast(`読み込みに失敗しました (${err.code})`)),
    store.subscribe(render),
  ];
  $list.innerHTML = '<div class="spinner small"></div>';
  return () => unsubs.forEach((u) => u());
}
