import { col, getDocs, query, orderBy, limit } from './firebase.js';
import { monthKey, shiftMonth, todayStr, yen } from './util.js';
import { cat, summarize, shareFor } from './views/money.js';

// Gemini の APIキーは、この端末のブラウザにだけ保存する（Firestore やリポジトリには置かない）
const KEY_STORAGE = 'futari.geminiKey';
const MODEL_STORAGE = 'futari.geminiModel';
export const DEFAULT_MODEL = 'gemini-flash-latest';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const read = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 保存できない環境 */ } };

export const getApiKey = () => read(KEY_STORAGE);
export const setApiKey = (v) => write(KEY_STORAGE, v.trim());
export const getModel = () => read(MODEL_STORAGE) || DEFAULT_MODEL;
export const setModel = (v) => write(MODEL_STORAGE, v.trim() === DEFAULT_MODEL ? '' : v.trim());

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// アプリ内のデータを、Gemini に渡す文章にまとめる
export async function buildContext(store) {
  const name = (uid) => (uid ? store.name(uid) : '未定');
  const now = new Date();
  const thisMonth = monthKey();
  const months = Array.from({ length: 8 }, (_, i) => shiftMonth(thisMonth, i - 6));
  const [billSnaps, shopping, todos, events, photos] = await Promise.all([
    Promise.all(months.map((m) => getDocs(col('months', m, 'bills')))),
    getDocs(col('shopping')),
    getDocs(col('todos')),
    getDocs(col('events')),
    getDocs(query(col('photos'), orderBy('createdMs', 'desc'), limit(30))),
  ]);
  const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lines = [];
  const members = store.memberList();

  lines.push(`今日: ${todayStr()}（${WEEK[now.getDay()]}） ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);
  lines.push(`質問している人: ${store.name(store.user.uid)}`);
  lines.push(`メンバー: ${members.map((m) => `${m.name}（負担割合 ${shareFor(store, m.uid)}%）`).join('、')}`);

  lines.push('\n## 家計簿（月ごと）');
  months.forEach((m, i) => {
    const bills = docs(billSnaps[i]);
    if (!bills.length) return;
    const s = summarize(bills, store);
    lines.push(`### ${m}（合計 ${yen(s.total)}、支払済み ${yen(s.paidTotal)}）`);
    bills.forEach((b) => {
      const status = b.settled ? '精算済み' : b.paid ? '支払済み・未精算' : '未払い';
      lines.push(`- ${b.name || cat(b.category).label}: ${b.amount != null ? yen(b.amount) : '金額未入力'}、${status}、払う人: ${name(b.payer)}`
        + `${b.dueDate ? `、期限 ${b.dueDate}` : ''}${b.receiptCount ? `、領収書${b.receiptCount}枚` : ''}${b.note ? `、メモ: ${b.note}` : ''}`);
    });
    if (s.rows) {
      lines.push(`  負担額（割合で割った額）: ${s.rows.map((r) => `${r.name} ${yen(r.burden)}（支払った額 ${yen(r.paid)}）`).join('、')}`);
      if (s.pending.length && s.amount > 0) lines.push(`  未精算: ${s.debtor.name} → ${s.creditor.name} に ${yen(s.amount)}`);
    }
  });

  const shop = docs(shopping);
  lines.push('\n## 買い物リスト');
  lines.push(`まだ買っていない: ${shop.filter((x) => !x.done).map((x) => x.text).join('、') || 'なし'}`);
  lines.push(`買ったもの: ${shop.filter((x) => x.done).map((x) => x.text).join('、') || 'なし'}`);

  lines.push('\n## TODO');
  docs(todos).forEach((t) => {
    lines.push(`- [${t.done ? '完了' : '未完了'}] ${t.text}、担当: ${t.assignee ? name(t.assignee) : '2人'}${t.due ? `、期限 ${t.due}` : ''}${t.note ? `、メモ: ${t.note}` : ''}`);
  });

  lines.push('\n## 予定');
  docs(events).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '')).forEach((e) => {
    lines.push(`- ${e.date} ${e.time ? `${e.time}${e.endTime ? `-${e.endTime}` : ''}` : '終日'} ${e.title}${e.place ? `（${e.place}）` : ''}${e.note ? `、メモ: ${e.note}` : ''}、登録: ${name(e.createdBy)}`);
  });

  lines.push('\n## 写真（新しい順、最大30枚）');
  docs(photos).forEach((p) => {
    const d = new Date(p.createdMs);
    lines.push(`- ${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${name(p.createdBy)}が追加${p.caption ? `「${p.caption}」` : ''}`);
  });
  return lines.join('\n');
}

const SYSTEM = `あなたは同棲カップル2人用の共有アプリ「FUTARI」のアシスタントです。
下の「アプリのデータ」をもとに、日本語で簡潔に答えてください。
- 金額は「¥1,234」の形で書く。計算するときは途中の式も短く示す
- データにないことは推測せず「アプリにはその情報がありません」と伝える
- 一般的な相談（節約のコツ、デートの提案など）には普通に答えてよい
- 箇条書きは「- 」を使う。見出しや表は使わない`;

// 会話（[{ role: 'user'|'model', text }]）を送り、返答を少しずつ onText に渡す
export async function ask(history, context, onText, signal) {
  const key = getApiKey();
  const body = {
    systemInstruction: { parts: [{ text: `${SYSTEM}\n\n# アプリのデータ\n${context}` }] },
    contents: history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
  };
  const res = await fetch(`${API}/${encodeURIComponent(getModel())}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).error?.message || ''; } catch { /* 本文なし */ }
    const err = new Error(message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n');
    buffer = events.pop();
    for (const line of events) {
      if (!line.startsWith('data:')) continue;
      try {
        const json = JSON.parse(line.slice(5));
        const part = json.candidates?.[0]?.content?.parts?.map((p) => (p.thought ? '' : p.text || '')).join('') || '';
        if (part) {
          text += part;
          onText(text);
        }
      } catch { /* 途中で切れた行は次の読み込みで続きが来る */ }
    }
  }
  return text;
}

export function errorMessage(err) {
  if (err.name === 'AbortError') return '';
  const msg = err.message || '';
  if (err.status === 400 && /API key/i.test(msg)) return 'APIキーが正しくありません。設定画面で確認してください。';
  if (err.status === 403) return 'このAPIキーでは使えません。キーの権限を確認してください。';
  if (err.status === 404) return `モデル「${getModel()}」が見つかりません。設定画面でモデル名を確認してください。`;
  if (err.status === 429) return '利用回数の上限に達しました。少し時間をおいて試してください。';
  if (err.status >= 500) return 'Gemini 側で問題が起きています。少し時間をおいて試してください。';
  if (err instanceof TypeError) return '通信できませんでした。電波の状態を確認してください。';
  return `エラーが発生しました（${msg}）`;
}
