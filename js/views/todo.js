import {
  db, col, doc, onSnapshot, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, toast, h, todayStr } from '../util.js';

const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 期限が近い順、期限なしは後ろ、同じなら新しい順
export const sortTodos = (list) => list.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')
  || (b.createdMs || 0) - (a.createdMs || 0));

export function mount(el, { store }) {
  let todos = null;
  let filter = 'all';
  let assignee = '';
  const todosRef = col('todos');
  const todoRef = (id) => doc(todosRef, id);

  el.innerHTML = `
    <header class="page-head"><h1>TODO</h1></header>
    <form class="add-row" id="add">
      <input name="text" placeholder="やることを入力" maxlength="80" autocomplete="off" enterkeyhint="done">
      <button class="btn btn-primary" aria-label="追加">${icon('plus', 20)}</button>
    </form>
    <div class="assignee-pick" id="assignee"></div>
    <div class="filter-row" id="filters"></div>
    <section id="list"></section>`;
  const $list = el.querySelector('#list');
  const form = el.querySelector('#add');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    form.elements.text.value = '';
    await addDoc(todosRef, {
      text, done: false, assignee: assignee || null, due: null,
      createdBy: store.user.uid, createdAt: serverTimestamp(), createdMs: Date.now(),
    }).catch((err) => toast(`追加に失敗しました (${err.code})`));
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const item = todos?.find((i) => i.id === t.dataset.id);
    const act = t.dataset.act;
    if (act === 'assignee') {
      assignee = t.dataset.uid;
      renderControls();
    }
    if (act === 'filter') {
      filter = t.dataset.filter;
      renderControls();
      render();
    }
    if (act === 'toggle' && item) {
      await updateDoc(todoRef(item.id), {
        done: !item.done, doneBy: item.done ? null : store.user.uid, doneMs: item.done ? null : Date.now(),
      }).catch((err) => toast(`更新に失敗しました (${err.code})`));
    }
    if (act === 'edit' && item) openEditor(item);
    if (act === 'clear') {
      const done = todos.filter((i) => i.done);
      if (!confirm(`終わったこと${done.length}件を消しますか？`)) return;
      const batch = writeBatch(db);
      done.forEach((i) => batch.delete(todoRef(i.id)));
      await batch.commit().catch((err) => toast(`削除に失敗しました (${err.code})`));
    }
  });

  function renderControls() {
    const members = store.memberList();
    el.querySelector('#assignee').innerHTML = `
      <span class="label">担当</span>
      ${[{ uid: '', name: '2人' }, ...members].map((m) => `
        <button type="button" class="chip ${assignee === m.uid ? 'chip-on' : ''}" data-act="assignee" data-uid="${m.uid}">
          ${m.tone ? `<span class="dot tone-${m.tone}"></span>` : ''}${esc(m.name)}
        </button>`).join('')}`;
    const filters = [
      { id: 'all', label: 'すべて' },
      { id: 'mine', label: '自分の' },
      { id: 'overdue', label: '期限切れ' },
    ];
    el.querySelector('#filters').innerHTML = filters.map((x) => `
      <button class="filter ${filter === x.id ? 'on' : ''}" data-act="filter" data-filter="${x.id}">${x.label}</button>`).join('');
  }

  const row = (i) => {
    const who = i.assignee ? store.member(i.assignee) : null;
    const overdue = !i.done && i.due && i.due < todayStr();
    return `
      <li class="shop-item ${i.done ? 'done' : ''}">
        <button class="check" data-act="toggle" data-id="${i.id}" aria-label="${i.done ? '未完了に戻す' : '完了'}">
          ${icon(i.done ? 'check' : 'circle', 20)}
        </button>
        <button class="todo-body" data-act="edit" data-id="${i.id}">
          <span class="shop-text">${esc(i.text)}</span>
          <span class="bill-meta">
            ${who ? `<span class="who tone-${who.tone}">${esc(who.name)}</span>` : '<span class="who both">2人</span>'}
            ${i.due ? `<span class="${overdue ? 'overdue' : ''}">${icon('calendar', 13)}${shortDate(i.due)}${overdue ? ' 期限切れ' : ''}</span>` : ''}
          </span>
        </button>
      </li>`;
  };

  function render() {
    if (!todos) return;
    const today = todayStr();
    const match = (i) => (filter === 'mine' ? !i.assignee || i.assignee === store.user.uid
      : filter === 'overdue' ? i.due && i.due < today : true);
    const open = sortTodos(todos.filter((i) => !i.done && match(i)));
    const done = todos.filter((i) => i.done).sort((a, b) => (b.doneMs || 0) - (a.doneMs || 0));
    if (!todos.length) {
      $list.innerHTML = `
        <div class="empty">
          ${icon('checkCircle', 40, 'muted')}
          <p>やることはありません</p>
        </div>`;
      return;
    }
    $list.innerHTML = `
      ${open.length ? `<ul class="card shop-list">${open.map(row).join('')}</ul>`
        : `<p class="empty-line">${icon('checkCircle', 18)}${filter === 'all' ? '全部終わりました' : '該当するものはありません'}</p>`}
      ${done.length && filter === 'all' ? `
        <div class="section-row">
          <h2 class="section-title">終わったこと（${done.length}）</h2>
          <button class="btn btn-ghost btn-small" data-act="clear">${icon('trash', 16)}<span>まとめて消す</span></button>
        </div>
        <ul class="card shop-list">${done.map(row).join('')}</ul>` : ''}`;
  }

  function openEditor(item) {
    const members = store.memberList();
    const dlg = h(`
      <dialog class="sheet">
        <form method="dialog">
          <header class="sheet-head">
            <h2>TODOを編集</h2>
            <button type="button" class="icon-btn" data-close aria-label="閉じる">${icon('close')}</button>
          </header>
          <label class="field">
            <span>やること</span>
            <input name="text" value="${esc(item.text)}" maxlength="80" required>
          </label>
          <fieldset class="field">
            <span>担当</span>
            <div class="segmented">
              <label><input type="radio" name="assignee" value="" ${!item.assignee ? 'checked' : ''}><span>2人</span></label>
              ${members.map((m) => `
                <label><input type="radio" name="assignee" value="${m.uid}" ${item.assignee === m.uid ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}
            </div>
          </fieldset>
          <label class="field">
            <span>期限</span>
            <input name="due" type="date" value="${item.due || ''}">
          </label>
          <label class="field">
            <span>メモ</span>
            <input name="note" value="${esc(item.note || '')}" maxlength="200">
          </label>
          <footer class="sheet-foot">
            <button type="button" class="btn btn-danger" data-delete>${icon('trash', 18)}<span>削除</span></button>
            <button type="submit" class="btn btn-primary">${icon('check', 18)}<span>保存</span></button>
          </footer>
        </form>
      </dialog>`);
    document.body.appendChild(dlg);
    const f = dlg.querySelector('form').elements;
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.querySelector('[data-delete]').addEventListener('click', async () => {
      dlg.close();
      await deleteDoc(todoRef(item.id)).catch((err) => toast(`削除に失敗しました (${err.code})`));
    });
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = f.text.value.trim();
      if (!text) return;
      dlg.close();
      await updateDoc(todoRef(item.id), {
        text, assignee: f.assignee.value || null, due: f.due.value || null, note: f.note.value.trim(),
      }).catch((err) => toast(`保存に失敗しました (${err.code})`));
    });
    dlg.showModal();
  }

  const unsubs = [
    onSnapshot(todosRef, (snap) => {
      todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (err) => toast(`読み込みに失敗しました (${err.code})`)),
    store.subscribe(() => { renderControls(); render(); }),
  ];
  renderControls();
  $list.innerHTML = '<div class="spinner small"></div>';
  return () => {
    unsubs.forEach((u) => u());
    document.querySelectorAll('dialog.sheet').forEach((d) => d.remove());
  };
}
