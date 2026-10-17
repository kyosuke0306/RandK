import {
  db, col, ref, doc, getDoc, onSnapshot, updateDoc, writeBatch, query, orderBy, limit, serverTimestamp,
} from '../firebase.js';
import { icon } from '../icons.js';
import { esc, toast, h } from '../util.js';

// 写真は Firebase Storage を使わず、縮小して Firestore に保存する（無料枠で使えるように）。
// 一覧用の小さい画像は photos、元の大きさの画像は photoData に分けて、一覧を軽くしている。
const FULL_MAX = 1600;
const THUMB_MAX = 400;
const DOC_LIMIT = 900_000; // Firestore の1ドキュメント上限（1MiB）より少し小さく
const PAGE = 60;

async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function encode(img, max, quality, maxChars) {
  let size = max;
  for (;;) {
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const hgt = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
    for (let q = quality; q >= 0.45; q -= 0.1) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length <= maxChars) return { data, w, h: hgt };
    }
    size = Math.round(size * 0.75);
  }
}

const dateLabel = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

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
      const img = await loadImage(file);
      const full = encode(img, FULL_MAX, 0.82, DOC_LIMIT);
      const thumb = encode(img, THUMB_MAX, 0.7, 120_000);
      img.close?.();
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
    const by = store.member(p.createdBy);
    const dlg = h(`
      <dialog class="viewer">
        <header class="viewer-head">
          <button class="icon-btn" data-close aria-label="閉じる">${icon('close')}</button>
          <span class="viewer-meta">${by ? esc(by.name) : ''}<br><small>${dateLabel(p.createdMs)}</small></span>
          <button class="icon-btn" data-share aria-label="保存・共有">${icon('share')}</button>
          <button class="icon-btn" data-delete aria-label="削除">${icon('trash')}</button>
        </header>
        <div class="viewer-body"><img src="${p.thumb}" alt=""></div>
        <footer class="viewer-foot">
          <input data-caption value="${esc(p.caption || '')}" placeholder="ひとことを追加" maxlength="100">
        </footer>
      </dialog>`);
    document.body.appendChild(dlg);
    const $img = dlg.querySelector('.viewer-body img');
    let full = null;
    getDoc(ref('photoData', p.id)).then((snap) => {
      full = snap.data()?.data;
      if (full) $img.src = full;
    });

    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    const $caption = dlg.querySelector('[data-caption]');
    const saveCaption = () => {
      const caption = $caption.value.trim();
      if (caption !== (p.caption || '')) {
        p.caption = caption;
        updateDoc(ref('photos', p.id), { caption }).catch((err) => toast(`保存に失敗しました (${err.code})`));
      }
    };
    $caption.addEventListener('change', saveCaption);
    $caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') $caption.blur(); });

    dlg.querySelector('[data-share]').addEventListener('click', async () => {
      const src = full || p.thumb;
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], `photo-${p.id}.jpg`, { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        navigator.share({ files: [file] }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    });

    dlg.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm('この写真を削除しますか？2人とも見られなくなります。')) return;
      dlg.close();
      const batch = writeBatch(db);
      batch.delete(ref('photos', p.id));
      batch.delete(ref('photoData', p.id));
      await batch.commit().catch((err) => toast(`削除に失敗しました (${err.code})`));
    });

    dlg.showModal();
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
