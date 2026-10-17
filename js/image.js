import { getDoc } from './firebase.js';
import { icon } from './icons.js';
import { esc, h } from './util.js';

// 画像は Firebase Storage を使わず、縮小して Firestore に保存する（無料枠で使えるように）。
// 一覧用の小さい画像と、拡大表示用の画像を別のドキュメントに分けて、一覧を軽くしている。
const FULL_MAX = 1600;
const THUMB_MAX = 400;
const DOC_LIMIT = 900_000; // Firestore の1ドキュメント上限（1MiB）より少し小さく

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

// 撮影・選択した画像を、保存用の大きい画像と一覧用のサムネイルに変換する
export async function processImage(file) {
  const img = await loadImage(file);
  const full = encode(img, FULL_MAX, 0.82, DOC_LIMIT);
  const thumb = encode(img, THUMB_MAX, 0.7, 120_000);
  img.close?.();
  return { full, thumb };
}

export const dateLabel = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 全画面で画像を表示する。fullRef があれば大きい画像を読み込んで差し替える。
export function openImageViewer({
  thumb, fullRef, title = '', subtitle = '', fileName = 'photo.jpg', caption, onDelete, deleteMessage,
}) {
  const dlg = h(`
    <dialog class="viewer">
      <header class="viewer-head">
        <button class="icon-btn" data-close aria-label="閉じる">${icon('close')}</button>
        <span class="viewer-meta">${esc(title)}<br><small>${esc(subtitle)}</small></span>
        <button class="icon-btn" data-share aria-label="保存・共有">${icon('share')}</button>
        ${onDelete ? `<button class="icon-btn" data-delete aria-label="削除">${icon('trash')}</button>` : ''}
      </header>
      <div class="viewer-body"><img src="${thumb}" alt=""></div>
      ${caption ? `
        <footer class="viewer-foot">
          <input data-caption value="${esc(caption.value || '')}" placeholder="ひとことを追加" maxlength="100">
        </footer>` : ''}
    </dialog>`);
  document.body.appendChild(dlg);
  const $img = dlg.querySelector('.viewer-body img');
  let full = null;
  if (fullRef) {
    getDoc(fullRef).then((snap) => {
      full = snap.data()?.data;
      if (full) $img.src = full;
    });
  }

  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());

  const $caption = dlg.querySelector('[data-caption]');
  if ($caption) {
    let saved = caption.value || '';
    $caption.addEventListener('change', () => {
      const value = $caption.value.trim();
      if (value === saved) return;
      saved = value;
      caption.onSave(value);
    });
    $caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') $caption.blur(); });
  }

  dlg.querySelector('[data-share]').addEventListener('click', async () => {
    const blob = await (await fetch(full || thumb)).blob();
    const file = new File([blob], fileName, { type: 'image/jpeg' });
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

  dlg.querySelector('[data-delete]')?.addEventListener('click', () => {
    if (!confirm(deleteMessage || 'この画像を削除しますか？')) return;
    dlg.close();
    onDelete();
  });

  dlg.showModal();
  return dlg;
}
