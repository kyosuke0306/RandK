import { yen, monthLabel, todayStr } from './util.js';
import { cat, summarize, isFixedAmount } from './views/money.js';

// その月の支払い一覧を、LINE などで送って一目でわかる画像（PNG）にする。
// 画面の明暗の設定に関係なく、白地で読みやすい配色で描く。
const W = 600; // 論理幅（2倍の解像度で描く）
const SCALE = 2;
const PAD = 28;
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
const C = {
  bg: '#f6f4f0', card: '#ffffff', text: '#22231f', muted: '#7a7a72', line: '#ece8e0',
  primary: '#2f6f62', primarySoft: '#dcebe6', ok: '#2f8a5b', okSoft: '#e0f1e7',
  warn: '#b26d12', warnSoft: '#fbeed9', danger: '#c2453a', toneA: '#3d7ac4', toneB: '#d0607a',
  cats: {
    rent: '#7a5cc4', electricity: '#d39a12', gas: '#d9653b', water: '#2f8fc4',
    internet: '#2f9b8a', phone: '#5b6bd1', other: '#808078',
  },
};

const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;
const dateText = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

// 幅に収まらない文字は … で切る
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function status(b) {
  if (b.settled) return { text: '精算済み', color: C.ok, bg: C.okSoft };
  if (b.paid) return { text: '支払済み', color: C.primary, bg: C.primarySoft };
  return { text: '未払い', color: C.warn, bg: C.warnSoft };
}

export async function renderBillsImage({ month, bills, store }) {
  await document.fonts?.ready;
  const s = summarize(bills, store);
  const name = (uid) => (uid ? store.name(uid) : '');
  const toneColor = (uid) => (store.member(uid)?.tone === 'b' ? C.toneB : C.toneA);
  const today = todayStr();

  const ROW = 76;
  const headerH = 92;
  const summaryH = s.rows ? 118 : 96;
  const listTitleH = 40;
  const listH = bills.length * ROW + 8;
  const unpaidBills = bills.filter((b) => !b.paid);
  const showSettle = s.rows && s.pending.length && s.amount > 0;
  const footBoxH = showSettle || unpaidBills.length ? 84 : 0;
  const H = PAD + headerH + summaryH + 16 + listTitleH + listH + (footBoxH ? footBoxH + 16 : 0) + 40 + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  let y = PAD;

  // 見出し
  ctx.fillStyle = C.primary;
  ctx.font = font(13, 700);
  ctx.fillText('FUTARI  支払い一覧', PAD, y + 16);
  ctx.fillStyle = C.text;
  ctx.font = font(30, 700);
  ctx.fillText(`${monthLabel(month)}の支払い`, PAD, y + 56);
  ctx.fillStyle = C.muted;
  ctx.font = font(13);
  ctx.textAlign = 'right';
  ctx.fillText(`${dateText(today)} 時点`, W - PAD, y + 56);
  ctx.textAlign = 'left';
  y += headerH;

  // 合計と2人の負担額
  roundRect(ctx, PAD, y, W - PAD * 2, summaryH, 18, C.card);
  const ix = PAD + 22;
  ctx.fillStyle = C.muted;
  ctx.font = font(13, 600);
  ctx.fillText('合計', ix, y + 30);
  ctx.fillStyle = C.text;
  ctx.font = font(34, 700);
  ctx.fillText(yen(s.total), ix, y + 70);
  ctx.fillStyle = C.muted;
  ctx.font = font(13);
  ctx.fillText(`${bills.length}件中 ${s.paidBills.length}件 支払済み`, ix, y + (s.rows ? 96 : 84));
  if (s.rows) {
    // 右側に、それぞれの負担額
    const rx = W - PAD - 22;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.muted;
    ctx.font = font(13, 600);
    ctx.fillText('それぞれの負担', rx, y + 30);
    s.rows.forEach((r, i) => {
      const ry = y + 60 + i * 30;
      ctx.fillStyle = C.text;
      ctx.font = font(20, 700);
      const amt = yen(r.burden);
      ctx.fillText(amt, rx, ry);
      const aw = ctx.measureText(amt).width;
      ctx.font = font(14, 600);
      const label = `${r.name}（${r.share}%）`;
      const label2 = fit(ctx, label, 170);
      ctx.fillStyle = toneColor(r.uid);
      ctx.fillText(label2, rx - aw - 10, ry);
    });
    ctx.textAlign = 'left';
  }
  y += summaryH + 16;

  // 一覧
  ctx.fillStyle = C.text;
  ctx.font = font(16, 700);
  ctx.fillText('内訳', PAD + 4, y + 24);
  y += listTitleH;
  roundRect(ctx, PAD, y, W - PAD * 2, listH, 18, C.card);
  bills.forEach((b, i) => {
    const top = y + 4 + i * ROW;
    const c = cat(b.category);
    if (i > 0) {
      ctx.fillStyle = C.line;
      ctx.fillRect(PAD + 18, top, W - PAD * 2 - 36, 1);
    }
    // 種類の色の印
    roundRect(ctx, PAD + 18, top + 16, 6, ROW - 32, 3, C.cats[c.id] || C.cats.other);
    const x = PAD + 36;
    const right = W - PAD - 18;

    // 1行目: 名前と金額
    ctx.font = font(20, 700);
    ctx.textAlign = 'right';
    ctx.fillStyle = b.amount ? C.text : C.muted;
    const amountText = b.amount ? yen(b.amount) : '未入力';
    ctx.fillText(amountText, right, top + 33);
    const amountW = ctx.measureText(amountText).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.font = font(17, 700);
    ctx.fillText(fit(ctx, b.name || c.label, right - x - amountW - 16), x, top + 32);

    // 2行目: 支払日・支払い方法・払う人 と 状態
    const st = status(b);
    ctx.font = font(12, 700);
    const pillW = ctx.measureText(st.text).width + 18;
    roundRect(ctx, right - pillW, top + 44, pillW, 22, 11, st.bg);
    ctx.fillStyle = st.color;
    ctx.textAlign = 'center';
    ctx.fillText(st.text, right - pillW / 2, top + 59);
    ctx.textAlign = 'left';

    const overdue = !b.paid && b.dueDate && b.dueDate < today;
    const parts = [];
    parts.push({ text: b.dueDate ? `${dateText(b.dueDate)}${overdue ? ' 期限切れ' : ''}` : '支払日 未設定', color: overdue ? C.danger : b.dueDate ? C.text : C.muted, weight: b.dueDate ? 700 : 400 });
    parts.push({ text: b.method || '支払い方法 未設定', color: b.method ? C.text : C.muted, weight: 400 });
    if (b.payer) parts.push({ text: `${name(b.payer)}${b.paid ? 'が支払い' : 'が払う'}`, color: toneColor(b.payer), weight: 700 });
    if (isFixedAmount(b) && b.amount) parts.push({ text: '毎月固定', color: C.muted, weight: 400 });
    let px = x;
    const maxX = right - pillW - 10;
    parts.forEach((p, j) => {
      if (px >= maxX) return;
      if (j > 0) {
        ctx.fillStyle = C.line;
        ctx.fillRect(px + 7, top + 50, 1, 12);
        px += 15;
      }
      ctx.font = font(13, p.weight);
      ctx.fillStyle = p.color;
      const t = fit(ctx, p.text, maxX - px);
      ctx.fillText(t, px, top + 60);
      px += ctx.measureText(t).width;
    });
  });
  y += listH + 16;

  // 未払いの残りと精算
  if (footBoxH) {
    roundRect(ctx, PAD, y, W - PAD * 2, footBoxH, 18, showSettle ? C.primarySoft : C.warnSoft);
    const fx = PAD + 22;
    if (unpaidBills.length) {
      const rest = unpaidBills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
      ctx.fillStyle = C.warn;
      ctx.font = font(14, 700);
      ctx.fillText(`未払い ${unpaidBills.length}件  ${yen(rest)}`, fx, y + (showSettle ? 32 : 48));
    }
    if (showSettle) {
      const sy = y + (unpaidBills.length ? 63 : 50);
      ctx.fillStyle = C.primary;
      ctx.font = font(13, 600);
      ctx.fillText('精算', fx, sy - 1);
      ctx.font = font(18, 700);
      ctx.fillStyle = C.text;
      const line = `${s.debtor.name} → ${s.creditor.name}`;
      ctx.fillText(fit(ctx, line, 300), fx + 40, sy);
      ctx.textAlign = 'right';
      ctx.font = font(24, 700);
      ctx.fillStyle = C.primary;
      ctx.fillText(yen(s.amount), W - PAD - 22, sy + 1);
      ctx.textAlign = 'left';
    }
    y += footBoxH + 16;
  }

  ctx.fillStyle = C.muted;
  ctx.font = font(11);
  ctx.textAlign = 'center';
  ctx.fillText('FUTARI で作成', W / 2, y + 20);

  return canvas.toDataURL('image/png');
}
