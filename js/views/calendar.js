import {
  col, doc, onSnapshot, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, toast, h, monthKey, todayStr, shiftMonth, monthLabel } from '../util.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export const dayLabel = (date) => {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
};

export const timeLabel = (e) => {
  if (!e.time) return '終日';
  return e.endTime ? `${e.time} - ${e.endTime}` : e.time;
};

export const sortEvents = (list) => list.sort((a, b) => a.date.localeCompare(b.date)
  || (a.time || '').localeCompare(b.time || ''));

export function mount(el, { store }) {
  let month = monthKey();
  let selected = todayStr();
  let events = null;
  let unsub = null;
  const eventsRef = col('events');

  el.innerHTML = `
    <header class="month-bar">
      <button class="icon-btn" data-act="prev" aria-label="前の月">${icon('chevronLeft')}</button>
      <button class="month-title" data-act="today"></button>
      <button class="icon-btn" data-act="next" aria-label="次の月">${icon('chevronRight')}</button>
    </header>
    <div class="card cal">
      <div class="cal-week">${WEEK.map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
      <div class="cal-grid" id="grid"></div>
    </div>
    <section id="day"></section>
    <section id="month-list"></section>
    <button class="fab" data-act="add" aria-label="予定を追加">${icon('plus', 26)}</button>`;

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'prev') setMonth(shiftMonth(month, -1));
    if (act === 'next') setMonth(shiftMonth(month, 1));
    if (act === 'today') {
      selected = todayStr();
      setMonth(monthKey());
    }
    if (act === 'day') {
      selected = t.dataset.date;
      render();
    }
    if (act === 'add') openEditor({ date: selected });
    if (act === 'edit') openEditor(events.find((ev) => ev.id === t.dataset.id));
  });

  function setMonth(key) {
    month = key;
    if (!selected.startsWith(key)) selected = key === monthKey() ? todayStr() : `${key}-01`;
    listen();
  }

  function listen() {
    unsub?.();
    events = null;
    el.querySelector('.month-title').textContent = monthLabel(month);
    render();
    const q = query(eventsRef, where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`));
    unsub = onSnapshot(q, (snap) => {
      events = sortEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      render();
    }, (err) => toast(`読み込みに失敗しました (${err.code})`));
  }

  const eventRow = (ev, withDate) => {
    const by = store.member(ev.createdBy);
    return `
      <button class="event-row" data-act="edit" data-id="${ev.id}">
        <span class="event-bar tone-${by?.tone || 'a'}"></span>
        <span class="event-main">
          <span class="event-title">${esc(ev.title)}</span>
          <span class="event-meta">
            <span>${icon('clock', 13)}${withDate ? `${dayLabel(ev.date)} ` : ''}${timeLabel(ev)}</span>
            ${ev.place ? `<span>${icon('mapPin', 13)}${esc(ev.place)}</span>` : ''}
          </span>
          ${ev.note ? `<span class="bill-note">${esc(ev.note)}</span>` : ''}
        </span>
      </button>`;
  };

  function render() {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    const today = todayStr();
    const byDate = {};
    (events || []).forEach((ev) => { (byDate[ev.date] ||= []).push(ev); });

    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<span></span>');
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const dow = (first + d - 1) % 7;
      const list = byDate[date] || [];
      cells.push(`
        <button class="cal-day ${date === today ? 'today' : ''} ${date === selected ? 'selected' : ''} ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}"
          data-act="day" data-date="${date}" aria-label="${dayLabel(date)}${list.length ? ` 予定${list.length}件` : ''}">
          <span class="num">${d}</span>
          <span class="dots">${list.slice(0, 3).map((ev) => `<i class="tone-${store.member(ev.createdBy)?.tone || 'a'}"></i>`).join('')}</span>
        </button>`);
    }
    el.querySelector('#grid').innerHTML = cells.join('');

    const $day = el.querySelector('#day');
    const $list = el.querySelector('#month-list');
    if (!events) {
      $day.innerHTML = '<div class="spinner small"></div>';
      $list.innerHTML = '';
      return;
    }
    const dayEvents = byDate[selected] || [];
    $day.innerHTML = `
      <h2 class="section-title">${dayLabel(selected)}</h2>
      ${dayEvents.length
        ? `<div class="card event-list">${dayEvents.map((ev) => eventRow(ev, false)).join('')}</div>`
        : `<button class="card empty-add" data-act="add">${icon('plus', 18)}<span>この日に予定を追加</span></button>`}`;
    $list.innerHTML = events.length ? `
      <h2 class="section-title">${m}月の予定（${events.length}）</h2>
      <div class="card event-list">${events.map((ev) => eventRow(ev, true)).join('')}</div>` : '';
  }

  function openEditor(ev) {
    if (!ev) return;
    const isNew = !ev.id;
    const dlg = h(`
      <dialog class="sheet">
        <form method="dialog">
          <header class="sheet-head">
            <h2>${isNew ? '予定を追加' : '予定を編集'}</h2>
            <button type="button" class="icon-btn" data-close aria-label="閉じる">${icon('close')}</button>
          </header>
          <label class="field">
            <span>タイトル</span>
            <input name="title" value="${esc(ev.title || '')}" placeholder="映画、旅行、ごはん など" maxlength="60" required>
          </label>
          <label class="field">
            <span>日付</span>
            <input name="date" type="date" value="${ev.date}" required>
          </label>
          <label class="switch-row">
            <span>終日</span>
            <input type="checkbox" name="allDay" class="switch" ${!ev.time ? 'checked' : ''}>
          </label>
          <div class="field-row times" ${!ev.time ? 'hidden' : ''}>
            <label class="field">
              <span>開始</span>
              <input name="time" type="time" value="${ev.time || '12:00'}">
            </label>
            <label class="field">
              <span>終了</span>
              <input name="endTime" type="time" value="${ev.endTime || ''}">
            </label>
          </div>
          <label class="field">
            <span>場所</span>
            <input name="place" value="${esc(ev.place || '')}" maxlength="60">
          </label>
          <label class="field">
            <span>メモ</span>
            <input name="note" value="${esc(ev.note || '')}" maxlength="200">
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
    f.allDay.addEventListener('change', () => { form.querySelector('.times').hidden = f.allDay.checked; });
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

    dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!confirm(`「${ev.title}」を削除しますか？`)) return;
      dlg.close();
      await deleteDoc(doc(eventsRef, ev.id)).catch((err) => toast(`削除に失敗しました (${err.code})`));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        title: f.title.value.trim(),
        date: f.date.value,
        time: f.allDay.checked ? null : f.time.value || null,
        endTime: f.allDay.checked ? null : f.endTime.value || null,
        place: f.place.value.trim(),
        note: f.note.value.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: store.user.uid,
      };
      if (!data.title || !data.date) return;
      dlg.close();
      selected = data.date;
      if (!data.date.startsWith(month)) setMonth(data.date.slice(0, 7));
      try {
        if (isNew) await addDoc(eventsRef, { ...data, createdBy: store.user.uid, createdAt: serverTimestamp() });
        else await updateDoc(doc(eventsRef, ev.id), data);
      } catch (err) {
        toast(`保存に失敗しました (${err.code})`);
      }
    });

    dlg.showModal();
    if (isNew) f.title.focus();
  }

  const unsubStore = store.subscribe(render);
  listen();
  return () => {
    unsub?.();
    unsubStore();
    document.querySelectorAll('dialog.sheet').forEach((d) => d.remove());
  };
}
