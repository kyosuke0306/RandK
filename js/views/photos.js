import {
  db, col, ref, doc, onSnapshot, updateDoc, writeBatch, query, orderBy, limit, serverTimestamp,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, toast } from '../util.js';
import { processImage, openImageViewer, dateLabel } from '../image.js';

const PAGE = 60;

export function mount(el, { store }) {
  let photos = null;
  let count = PAGE;
  let uploading = 0;
  let unsubList = null;

  el.innerHTML = `
    <header class="page-head row">
      <h1>写真</h1>
    </header>
    <div class="photo-actions">
      <label class="btn btn-primary">
        ${icon('camera', 20)}<span>撮影する</span>
        <input type="file" accept="image/*" capture="environment" hidden data-pick>
      </label>
      <label class="btn">
        ${icon('image', 20)}<span>写真を選ぶ</span>
        <input type="file" accept="image/*" multiple hidden data-pick>
      </label>
    </div>
    <section id="grid"></section>`;
  const $grid = el.querySelector('#grid');

  el.querySelectorAll('[data-pick]').forEach((input) => {
    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      for (const file of files) await upload(file);
    });
  });

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'open') openViewer(photos.find((p) => p.id === t.dataset.id));
    if (t.dataset.act === 'more') {
      count += PAGE;
      listen();
    }
  });

  async function upload(file) {
    uploading++;
    render();
    try {
      const { full, thumb } = await processImage(file);
      const { id } = doc(col('photos'));
      const batch = writeBatch(db);
      batch.set(ref('photoData', id), { data: full.data });
      batch.set(ref('photos', id), {
        thumb: thumb.data, w: full.w, h: full.h, caption: '',
        createdBy: store.user.uid, createdMs: Date.now(), createdAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      console.error(err);
      toast(`保存できませんでした${err.code ? ` (${err.code})` : ''}`);
    } finally {
      uploading--;
      render();
    }
  }

  function render() {
    if (!photos) {
      $grid.innerHTML = '<div class="spinner small"></div>';
      return;
    }
    if (!photos.length && !uploading) {
      $grid.innerHTML = `
        <div class="empty">
          ${icon('image', 40, 'muted')}
          <p>まだ写真はありません<br>撮った写真は2人とも見られます</p>
        </div>`;
      return;
    }
    $grid.innerHTML = `
      <div class="photo-grid">
        ${Array.from({ length: uploading }, () => '<div class="photo-tile loading"><div class="spinner"></div></div>').join('')}
        ${photos.map((p) => `
          <button class="photo-tile" data-act="open" data-id="${p.id}" aria-label="写真を開く">
            <img src="${p.thumb}" alt="${esc(p.caption || '')}" loading="lazy">
          </button>`).join('')}
      </div>
      ${photos.length >= count ? `<button class="btn btn-ghost full" data-act="more">もっと見る</button>` : ''}`;
  }

  function openViewer(p) {
    if (!p) return;
    openImageViewer({
      thumb: p.thumb,
      fullRef: ref('photoData', p.id),
      title: store.member(p.createdBy)?.name || '',
      subtitle: dateLabel(p.createdMs),
      fileName: `photo-${p.id}.jpg`,
      caption: {
        value: p.caption,
        onSave: (caption) => updateDoc(ref('photos', p.id), { caption })
          .catch((err) => toast(`保存に失敗しました (${err.code})`)),
      },
      deleteMessage: 'この写真を削除しますか？2人とも見られなくなります。',
      onDelete: () => {
        const batch = writeBatch(db);
        batch.delete(ref('photos', p.id));
        batch.delete(ref('photoData', p.id));
        batch.commit().catch((err) => toast(`削除に失敗しました (${err.code})`));
      },
    });
  }

  function listen() {
    unsubList?.();
    unsubList = onSnapshot(query(col('photos'), orderBy('createdMs', 'desc'), limit(count)), (snap) => {
      photos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (err) => toast(`読み込みに失敗しました (${err.code})`));
  }

  listen();
  render();
  return () => {
    unsubList?.();
    document.querySelectorAll('dialog.viewer').forEach((d) => d.remove());
  };
}
