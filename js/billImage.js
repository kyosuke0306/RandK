import { yen, monthLabel, todayStr } from './util.js';
import {
  cat, summarize, isFixedAmount, payDayLabel, FIXED,
} from './views/money.js';

// 支払い一覧を、LINE などで送って一目でわかる画像（PNG）にする。
// 画面の明暗の設定に関係なく、白地で読みやすい配色で描く。
// 1か月なら項目ごとの詳しい一覧（先月比つき）、2か月以上なら
// 「各項目の支払い設定」「月ごとの合計の棒グラフ」「項目ごとの比較表」に分けて描く。
let W = 600; // 論理幅（2倍の解像度で描く）。項目が多い比較表では広げる
const SCALE = 2;
const PAD = 28;
const IN = 18; // カードの内側の余白
const NOTE_LH = 18;
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
const C = {
  bg: '#f6f4f0', card: '#ffffff', text: '#22231f', muted: '#7a7a72', line: '#ece8e0',
  primary: '#2f6f62', primarySoft: '#dcebe6', ok: '#2f8a5b', okSoft: '#e0f1e7',
  warn: '#b26d12', warnSoft: '#fbeed9', danger: '#c2453a', toneA: '#3d7ac4', toneB: '#d0607a',
  noteBg: '#f4f2ee',
  cats: {
    rent: '#7a5cc4', electricity: '#d39a12', gas: '#d9653b', water: '#2f8fc4',
    internet: '#2f9b8a', phone: '#5b6bd1', other: '#808078',
  },
};

const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;
const dateText = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const monthShort = (m) => `${Number(m.slice(5, 7))}月`;
const rangeLabel = (months) => {
  const a = months[0].month;
  const b = months.at(-1).month;
  if (a === b) return monthLabel(a);
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${monthLabel(a)}〜${monthShort(b)}`
    : `${monthLabel(a)}〜${monthLabel(b)}`;
};

function status(b) {
  if (b.settled) return { text: '精算済み', color: C.ok, bg: C.okSoft };
  if (b.paid) return { text: '支払済み', color: C.primary, bg: C.primarySoft };
  return { text: '未払い', color: C.warn, bg: C.warnSoft };
}

// 描画の道具。measure だけのときも同じ手順で高さを計算する。
function painter(ctx, store) {
  const p = {
    ctx,
    text(str, x, y, { size = 13, weight = 400, color = C.text, align = 'left', max } = {}) {
      ctx.font = font(size, weight);
      ctx.fillStyle = color;
      ctx.textAlign = align;
      const t = max ? p.fit(str, max) : str;
      ctx.fillText(t, x, y);
      ctx.textAlign = 'left';
      return ctx.measureText(t).width;
    },
    width(str, size, weight = 400) {
      ctx.font = font(size, weight);
      return ctx.measureText(str).width;
    },
    // 幅に収まらない文字は … で切る（ctx.font を先に設定しておく）
    fit(str, max) {
      if (ctx.measureText(str).width <= max) return str;
      let t = str;
      while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
      return `${t}…`;
    },
    // 長い文章を折り返す（最大 maxLines 行）
    wrap(str, max, size, maxLines = 3) {
      ctx.font = font(size);
      const lines = [];
      let cur = '';
      for (const ch of str) {
        if (cur && ctx.measureText(cur + ch).width > max) {
          lines.push(cur);
          cur = ch;
        } else cur += ch;
      }
      if (cur) lines.push(cur);
      if (lines.length <= maxLines) return lines;
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = p.fit(`${kept[maxLines - 1]}…`, max);
      return kept;
    },
    rect(x, y, w, h, r, fill) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = fill;
      ctx.fill();
    },
    hline(x, y, w) {
      ctx.fillStyle = C.line;
      ctx.fillRect(x, y, w, 1);
    },
    pill(st, right, top) {
      const w = p.width(st.text, 12, 700) + 18;
      p.rect(right - w, top, w, 22, 11, st.bg);
      p.text(st.text, right - w / 2, top + 15, { size: 12, weight: 700, color: st.color, align: 'center' });
      return w;
    },
    // 「11/27 | 口座振替 | りょうが払う」のように区切って並べる
    parts(list, x, y, maxX) {
      let px = x;
      list.forEach((part, j) => {
        if (px >= maxX - 10) return;
        if (j > 0) {
          ctx.fillStyle = C.line;
          ctx.fillRect(px + 7, y - 10, 1, 12);
          px += 15;
        }
        px += p.text(part.text, px, y, {
          size: part.size || 13, weight: part.weight || 400, color: part.color || C.text, max: maxX - px,
        });
      });
    },
    // メモ（ラベル付き、折り返し）。描いた高さを返す。draw=false なら高さだけ
    notes(list, x, y, w, draw = true) {
      let h = 0;
      list.filter((n) => n.text).forEach((n) => {
        const lw = p.width(n.label, 11, 700) + 16;
        const lines = p.wrap(n.text, w - lw - 10, 13);
        const boxH = lines.length * NOTE_LH + 10;
        if (draw) {
          p.rect(x, y + h, w, boxH, 8, C.noteBg);
          p.text(n.label, x + 8, y + h + 18, { size: 11, weight: 700, color: n.color });
          lines.forEach((l, i) => p.text(l, x + lw, y + h + 18 + i * NOTE_LH, { color: C.text }));
        }
        h += boxH + 4;
      });
      return h;
    },
    notesH: (list, w) => p.notes(list, 0, 0, w, false),
    tone: (uid) => (store.member(uid)?.tone === 'b' ? C.toneB : C.toneA),
  };
  return p;
}

function header(p, y, title, sub) {
  p.text('FUTARI  支払い一覧', PAD, y + 16, { weight: 700, color: C.primary });
  p.text(title, PAD, y + 56, { size: 28, weight: 700, max: W - PAD * 2 - 90 });
  p.text(sub, W - PAD, y + 56, { color: C.muted, align: 'right' });
  return y + 88;
}

function sectionTitle(p, y, title, right) {
  p.text(title, PAD + 4, y + 24, { size: 16, weight: 700 });
  if (right) p.text(right, W - PAD - 4, y + 24, { size: 14, weight: 700, align: 'right' });
  return y + 38;
}

// 合計と2人の負担額のカード
function summaryCard(p, y, { label, total, sub, rows }) {
  const h = rows ? 118 : 96;
  p.rect(PAD, y, W - PAD * 2, h, 18, C.card);
  const ix = PAD + 22;
  p.text(label, ix, y + 30, { weight: 600, color: C.muted });
  p.text(yen(total), ix, y + 70, { size: 34, weight: 700 });
  p.text(sub, ix, y + (rows ? 96 : 84), { color: C.muted });
  if (rows) {
    const rx = W - PAD - 22;
    p.text('それぞれの負担', rx, y + 30, { weight: 600, color: C.muted, align: 'right' });
    rows.forEach((r, i) => {
      const ry = y + 60 + i * 30;
      const aw = p.text(yen(r.burden), rx, ry, { size: 20, weight: 700, align: 'right' });
      p.text(`${r.name}（${r.share}%）`, rx - aw - 10, ry, {
        size: 14, weight: 600, color: p.tone(r.uid), align: 'right', max: 170,
      });
    });
  }
  return y + h + 16;
}

// ---- 1か月分 ----
function paintMonth(p, { month, bills }, store, prev) {
  const s = summarize(bills, store);
  const today = todayStr();
  let y = PAD;
  y = header(p, y, `${monthLabel(month)}の支払い`, `${dateText(today)} 時点`);
  y = summaryCard(p, y, {
    label: '合計', total: s.total, sub: `${bills.length}件中 ${s.paidBills.length}件 支払済み`, rows: s.rows,
  });
  y = sectionTitle(p, y, '内訳');

  const cardTop = y;
  const right = W - PAD - IN;
  const x = PAD + 36;
  // 先に高さを測ってカードを描き、その上に中身を描く
  const monthNotes = (b) => [
    { label: '毎月', text: b.fixedNote, color: C.primary },
    { label: 'この月', text: b.note, color: C.warn },
  ];
  const rowH = bills.map((b) => {
    const nh = p.notesH(monthNotes(b), right - x);
    return 76 + (nh ? nh + 8 : 0);
  });
  const cardH = rowH.reduce((a, b) => a + b, 0) + 8;
  p.rect(PAD, cardTop, W - PAD * 2, cardH, 18, C.card);

  let top = cardTop + 4;
  bills.forEach((b, i) => {
    const c = cat(b.category);
    if (i > 0) p.hline(PAD + IN, top, W - PAD * 2 - IN * 2);
    p.rect(PAD + IN, top + 16, 6, rowH[i] - 32, 3, C.cats[c.id] || C.cats.other);

    const amountText = b.amount ? yen(b.amount) : '未入力';
    const aw = p.text(amountText, right, top + 33, {
      size: b.amount ? 20 : 15, weight: 700, color: b.amount ? C.text : C.muted, align: 'right',
    });
    p.text(b.name || c.label, x, top + 32, { size: 17, weight: 700, max: right - x - aw - 16 });

    const pw = p.pill(status(b), right, top + 44);
    // 先月比
    let dw = 0;
    const pb = prev?.find((x) => itemKey(x) === itemKey(b));
    if (pb && pb.amount != null && b.amount != null) {
      const d = Math.round(b.amount - pb.amount);
      const t = !d ? '先月と同じ' : `先月比 ${d > 0 ? '+' : '−'}${yen(Math.abs(d))}`;
      dw = p.text(t, right - pw - 8, top + 60, {
        size: 12, weight: 700, color: !d ? C.muted : d > 0 ? C.danger : C.ok, align: 'right',
      }) + 12;
    }
    const overdue = !b.paid && b.dueDate && b.dueDate < today;
    const list = [
      b.dueDate
        ? { text: `${dateText(b.dueDate)}${overdue ? ' 期限切れ' : ''}`, color: overdue ? C.danger : C.text, weight: 700 }
        : { text: '支払日 未設定', color: C.muted },
      { text: b.method || '支払い方法 未設定', color: b.method ? C.text : C.muted },
    ];
    if (b.payer) list.push({ text: `${store.name(b.payer)}${b.paid ? 'が支払い' : 'が払う'}`, color: p.tone(b.payer), weight: 700 });
    if (isFixedAmount(b) && b.amount) list.push({ text: '毎月固定', color: C.muted });
    p.parts(list, x, top + 60, right - pw - 10 - dw);

    p.notes(monthNotes(b), x, top + 74, right - x);
    top += rowH[i];
  });
  y = cardTop + cardH + 16;

  const unpaid = bills.filter((b) => !b.paid);
  const showSettle = s.rows && s.pending.length && s.amount > 0;
  if (unpaid.length || showSettle) {
    const h = 84;
    p.rect(PAD, y, W - PAD * 2, h, 18, showSettle ? C.primarySoft : C.warnSoft);
    const fx = PAD + 22;
    if (unpaid.length) {
      const rest = unpaid.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
      p.text(`未払い ${unpaid.length}件  ${yen(rest)}`, fx, y + (showSettle ? 32 : 48), { size: 14, weight: 700, color: C.warn });
    }
    if (showSettle) {
      const sy = y + (unpaid.length ? 63 : 50);
      p.text('精算', fx, sy - 1, { weight: 600, color: C.primary });
      p.text(`${s.debtor.name} → ${s.creditor.name}`, fx + 40, sy, { size: 18, weight: 700, max: 300 });
      p.text(yen(s.amount), W - PAD - 22, sy + 1, { size: 24, weight: 700, color: C.primary, align: 'right' });
    }
    y += h + 16;
  }
  return y;
}

// ---- 複数月 ----
// 月をまたいで同じ項目をまとめる（家賃などは種類、それ以外は項目のID）
const itemKey = (b) => (FIXED.includes(b.category) ? b.category : b.id);

function paintMonths(p, months, store) {
  const today = todayStr();
  let y = PAD;
  y = header(p, y, `${rangeLabel(months)}の支払い`, `${dateText(today)} 時点`);

  // 期間全体の合計
  const sums = months.map((m) => summarize(m.bills, store));
  const total = sums.reduce((a, s) => a + s.total, 0);
  const rows = sums.at(-1).rows?.map((r) => ({
    ...r, burden: sums.reduce((a, s) => a + (s.rows?.find((x) => x.uid === r.uid)?.burden || 0), 0),
  }));
  y = summaryCard(p, y, {
    label: `${months.length}か月の合計`, total, sub: `1か月平均 ${yen(total / months.length)}`, rows,
  });

  // 1. 各項目の支払い設定（いちばん新しい月の設定を使う）
  const items = new Map();
  months.forEach(({ bills }) => bills.forEach((b) => {
    const prev = items.get(itemKey(b));
    items.set(itemKey(b), { ...b, months: (prev?.months || 0) + 1 });
  }));
  const list = [...items.values()];
  y = sectionTitle(p, y, '支払いの設定（毎月）');
  const right = W - PAD - IN;
  const x = PAD + 36;
  const setNotes = (b) => [{ label: '毎月のメモ', text: b.fixedNote, color: C.primary }];
  const setH = list.map((b) => {
    const nh = p.notesH(setNotes(b), right - x);
    return 70 + (nh ? nh + 6 : 0);
  });
  const setCardH = setH.reduce((a, b) => a + b, 0) + 8;
  p.rect(PAD, y, W - PAD * 2, setCardH, 18, C.card);
  let top = y + 4;
  list.forEach((b, i) => {
    const c = cat(b.category);
    if (i > 0) p.hline(PAD + IN, top, W - PAD * 2 - IN * 2);
    p.rect(PAD + IN, top + 16, 6, setH[i] - 32, 3, C.cats[c.id] || C.cats.other);
    const fixed = isFixedAmount(b) && b.amount;
    const aw = fixed
      ? p.text(`毎月 ${yen(b.amount)}`, right, top + 32, { size: 17, weight: 700, align: 'right' })
      : p.text('金額は月ごと', right, top + 31, { color: C.muted, align: 'right' });
    p.text(b.name || c.label, x, top + 32, { size: 17, weight: 700, max: right - x - aw - 16 });
    const day = payDayLabel(b.payDay) || (b.dueDate ? `毎月${Number(b.dueDate.slice(8, 10))}日ごろ` : '');
    const meta = [
      day ? { text: `支払日 ${day}`, weight: 700 } : { text: '支払日 未設定', color: C.muted },
      { text: b.method || '支払い方法 未設定', color: b.method ? C.text : C.muted },
    ];
    if (b.payer) meta.push({ text: `${store.name(b.payer)}が払う`, color: p.tone(b.payer), weight: 700 });
    p.parts(meta, x, top + 56, right);
    p.notes(setNotes(b), x, top + 68, right - x);
    top += setH[i];
  });
  y += setCardH + 16;

  // 2. 月ごとの合計（項目ごとに色分けした横棒）
  const keys = list.map(itemKey);
  const color = (b) => C.cats[cat(b.category).id] || C.cats.other;
  const amountOf = (bills, key) => bills.find((b) => itemKey(b) === key)?.amount;
  // 家賃など金額が固定の項目は棒を長くするだけなので、毎月変わる項目だけで比べる
  const variable = list.filter((b) => !(isFixedAmount(b) && b.amount));
  const chartList = variable.length ? variable : list;
  const chartKeys = chartList.map(itemKey);
  const chartSums = months.map(({ bills }) => chartKeys.reduce((a, k) => a + (Number(amountOf(bills, k)) || 0), 0));
  y = sectionTitle(p, y, variable.length && variable.length < list.length ? '毎月変わる支払い（固定の金額を除く）' : '月ごとの合計');
  const barRowH = 34;
  const legendLines = legendLayout(p, chartList, W - PAD * 2 - IN * 2);
  const chartH = months.length * barRowH + 20 + legendLines.length * 22 + 8;
  p.rect(PAD, y, W - PAD * 2, chartH, 18, C.card);
  const maxTotal = Math.max(...chartSums, 1);
  const labelW = 64;
  const totalW = 92;
  const barX = PAD + IN + labelW;
  const barW = W - PAD * 2 - IN * 2 - labelW - totalW;
  months.forEach(({ month, bills }, mi) => {
    const by = y + 14 + mi * barRowH;
    p.text(monthText(month, months), PAD + IN, by + 18, { size: 14, weight: 700 });
    let bx = barX;
    chartKeys.forEach((key, ki) => {
      const v = Number(amountOf(bills, key)) || 0;
      if (!v) return;
      const w = (v / maxTotal) * barW;
      p.ctx.fillStyle = color(chartList[ki]);
      p.ctx.fillRect(bx, by + 4, Math.max(w - 1, 1), 20);
      bx += w;
    });
    p.text(yen(chartSums[mi]), W - PAD - IN, by + 19, { size: 15, weight: 700, align: 'right' });
  });
  let ly = y + 14 + months.length * barRowH + 10;
  legendLines.forEach((line) => {
    line.forEach(({ b, x: lx }) => {
      p.rect(PAD + IN + lx, ly + 2, 10, 10, 3, color(b));
      p.text(b.name || cat(b.category).label, PAD + IN + lx + 14, ly + 12, { size: 12, color: C.muted });
    });
    ly += 22;
  });
  y += chartH + 16;

  // 3. 項目ごとの比較（行が月、列が項目）
  y = sectionTitle(p, y, '項目ごとの比較');
  const monthColW = 76;
  const sumColW = 92;
  const tableW = W - PAD * 2 - IN;
  const colW = (tableW - monthColW - sumColW) / keys.length;
  const headH = 44;
  const rowH = 50;
  const tableH = headH + (months.length + 1) * rowH + 8;
  p.rect(PAD, y, W - PAD * 2, tableH, 18, C.card);
  const tx = PAD + IN;
  const colRight = (i) => tx + monthColW + colW * (i + 1) - 6;
  // 見出し
  list.forEach((b, i) => {
    p.rect(colRight(i) - 8, y + 14, 8, 8, 2, color(b));
    const lines = p.wrap(b.name || cat(b.category).label, colW - 16, 12, 2);
    lines.forEach((l, li) => p.text(l, colRight(i) - 12, y + 22 + li * 15 - (lines.length - 1) * 4, {
      size: 12, weight: 700, color: C.muted, align: 'right',
    }));
  });
  p.text('合計', W - PAD - IN, y + 26, { size: 12, weight: 700, color: C.muted, align: 'right' });
  let ry = y + headH;
  const diffText = (cur, prev) => {
    if (cur == null || prev == null) return null;
    const d = Math.round(cur - prev);
    if (!d) return { text: '±0', color: C.muted };
    return d > 0 ? { text: `+${yen(d)}`, color: C.danger } : { text: `−${yen(-d)}`, color: C.ok };
  };
  const cell = (value, prev, right, rowTop, bold = false) => {
    if (value === undefined) {
      p.text('—', right, rowTop + 25, { color: C.muted, align: 'right' });
      return;
    }
    p.text(value == null ? '未入力' : yen(value), right, rowTop + (prev === undefined ? 31 : 23), {
      size: value == null ? 12 : bold ? 15 : 14, weight: 700, color: value == null ? C.muted : C.text, align: 'right',
    });
    const d = prev === undefined ? null : diffText(value, prev);
    if (d) p.text(d.text, right, rowTop + 40, { size: 11, weight: 600, color: d.color, align: 'right' });
  };
  months.forEach(({ month, bills }, mi) => {
    const s = sums[mi];
    if (mi % 2 === 0) p.rect(PAD + 8, ry, W - PAD * 2 - 16, rowH, 10, C.noteBg);
    p.text(monthText(month, months), tx, ry + 23, { size: 15, weight: 700 });
    const st = monthStatus(s);
    p.text(st.text, tx, ry + 40, { size: 11, weight: 700, color: st.color, max: monthColW - 6 });
    const prevBills = mi > 0 ? months[mi - 1].bills : null;
    keys.forEach((key, ki) => {
      const b = bills.find((x) => itemKey(x) === key);
      const prevB = prevBills?.find((x) => itemKey(x) === key);
      cell(b ? b.amount ?? null : undefined, prevBills && prevB ? prevB.amount ?? null : undefined, colRight(ki), ry);
    });
    cell(s.total, mi > 0 ? sums[mi - 1].total : undefined, W - PAD - IN, ry, true);
    ry += rowH;
  });
  // 平均
  p.hline(tx, ry, tableW - IN + 8);
  p.text('平均', tx, ry + 30, { size: 14, weight: 700, color: C.primary });
  keys.forEach((key, ki) => {
    const vals = months.map((m) => amountOf(m.bills, key)).filter((v) => v != null && v !== '');
    if (!vals.length) return;
    const avg = vals.reduce((a, v) => a + Number(v), 0) / vals.length;
    p.text(yen(avg), colRight(ki), ry + 30, { size: 13, weight: 700, color: C.primary, align: 'right' });
  });
  p.text(yen(total / months.length), W - PAD - IN, ry + 30, { size: 15, weight: 700, color: C.primary, align: 'right' });
  p.text('先月より増えた額は赤、減った額は緑で表示しています', PAD + 4, y + tableH + 18, { size: 11, color: C.muted });
  y += tableH + 30;

  // 4. その月だけのメモ
  const notes = months.flatMap(({ month, bills }) => bills.filter((b) => b.note)
    .map((b) => ({ label: `${monthText(month, months)} ${b.name || cat(b.category).label}`, text: b.note, color: C.warn })));
  if (notes.length) {
    y = sectionTitle(p, y, 'その月だけのメモ');
    const w = W - PAD * 2 - IN * 2;
    const nh = p.notesH(notes, w);
    p.rect(PAD, y, W - PAD * 2, nh + 24, 18, C.card);
    p.notes(notes, PAD + IN, y + 12, w);
    y += nh + 24 + 16;
  }
  return y;
}

// 月の見出し（年をまたぐときだけ年も付ける）
function monthText(month, months) {
  const years = new Set(months.map((m) => m.month.slice(0, 4)));
  return years.size > 1 ? `${month.slice(2, 4)}年${Number(month.slice(5, 7))}月` : monthShort(month);
}

function monthStatus(s) {
  if (s.allSettled) return { text: '精算済み', color: C.ok };
  if (s.unpaid) return { text: `未払い${s.unpaid}件`, color: C.warn };
  if (s.pending.length) return { text: '未精算', color: C.primary };
  return { text: '支払済み', color: C.primary };
}

// 凡例を行に分けて並べる
function legendLayout(p, list, width) {
  const lines = [[]];
  let x = 0;
  list.forEach((b) => {
    const w = 14 + p.width(b.name || cat(b.category).label, 12) + 16;
    if (x + w > width && lines.at(-1).length) {
      lines.push([]);
      x = 0;
    }
    lines.at(-1).push({ b, x });
    x += w;
  });
  return lines;
}

// months: [{ month: '2026-11', bills: [...] }, ...]（古い順）
// prev: 1か月のときの先月の項目（先月比に使う）
export async function renderBillsImage({ months, prev = null, store }) {
  await document.fonts?.ready;
  const itemCount = new Set(months.flatMap((m) => m.bills.map(itemKey))).size;
  W = months.length === 1 ? 600 : Math.max(600, PAD * 2 + 18 + 76 + 92 + itemCount * 84);
  const paint = (ctx) => {
    const p = painter(ctx, store);
    let y = months.length === 1 ? paintMonth(p, months[0], store, prev) : paintMonths(p, months, store);
    p.text('FUTARI で作成', W / 2, y + 20, { size: 11, color: C.muted, align: 'center' });
    y += 40 + PAD;
    return y;
  };
  // 1回目は高さを測るだけ
  const H = paint(document.createElement('canvas').getContext('2d'));
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = Math.ceil(H * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  paint(ctx);
  return canvas.toDataURL('image/png');
}
