import { icon } from '../icons.js';
import { esc } from '../util.js';
import {
  getApiKey, setApiKey, buildContext, ask, errorMessage,
} from '../gemini.js';

const SUGGESTIONS = [
  '今月の光熱費はいくら？',
  '精算はいくら残ってる？',
  '次の予定は？',
  '買うものを教えて',
  '自分のTODOは？',
  '先月と比べて電気代はどう？',
];

// 返答の簡単な整形（太字・箇条書き・改行）
function format(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m.replace(/\n/g, '')}</ul>`)
    .replace(/\n/g, '<br>');
}

// 会話は画面を移動しても残るよう、このタブの間だけ保存する
const loadHistory = () => { try { return JSON.parse(sessionStorage.getItem('askHistory')) || []; } catch { return []; } };
const saveHistory = (h) => { try { sessionStorage.setItem('askHistory', JSON.stringify(h)); } catch { /* 保存できない環境 */ } };

export function mount(el, { store, navigate }) {
  let history = loadHistory();
  let busy = false;
  let controller = null;
  let context = null;
  let contextAt = 0;

  function render() {
    if (!getApiKey()) return renderSetup();
    el.innerHTML = `
      <header class="page-head row">
        <button class="icon-btn back" data-act="back" aria-label="トップに戻る">${icon('chevronLeft')}</button>
        <h1>FUTARIに質問</h1>
        ${history.length ? `<button class="btn btn-ghost btn-small push-right" data-act="reset">${icon('plus', 16)}<span>新しく</span></button>` : ''}
      </header>
      <section class="chat" id="chat">
        ${history.length ? '' : `
          <div class="ask-intro">
            <span class="menu-icon">${icon('sparkle', 24)}</span>
            <p>家計簿・買い物・TODO・予定・写真の情報から答えます。</p>
          </div>
          <div class="suggest">
            ${SUGGESTIONS.map((q) => `<button class="chip" data-act="suggest">${esc(q)}</button>`).join('')}
          </div>`}
        ${history.map((m) => `<div class="msg ${m.role}">${m.role === 'user' ? esc(m.text) : format(m.text)}</div>`).join('')}
      </section>
      <form class="ask-bar" id="ask">
        <textarea name="q" rows="1" placeholder="質問を入力" maxlength="1000"></textarea>
        <button class="btn btn-primary" aria-label="送信" ${busy ? 'disabled' : ''}>${icon('send', 20)}</button>
      </form>`;
    const form = el.querySelector('#ask');
    const ta = form.elements.q;
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send(ta.value);
    });
    scrollDown();
  }

  function renderSetup() {
    el.innerHTML = `
      <header class="page-head row">
        <button class="icon-btn back" data-act="back" aria-label="トップに戻る">${icon('chevronLeft')}</button>
        <h1>FUTARIに質問</h1>
      </header>
      <section class="card setup">
        <span class="menu-icon">${icon('sparkle', 24)}</span>
        <h2>Gemini の APIキーを入れてください</h2>
        <ol>
          <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> を開いて、Googleアカウントでログイン</li>
          <li>「APIキーを作成」を押して、表示されたキーをコピー</li>
          <li>下に貼り付けて「保存」</li>
        </ol>
        <form class="inline-form" id="key-form">
          <input name="key" placeholder="AIza..." autocomplete="off" required>
          <button class="btn btn-primary">保存</button>
        </form>
        <p class="label">キーはこのスマホの中にだけ保存されます。2人それぞれのスマホで入力してください。質問するときは、アプリのデータが Google の Gemini に送られます。</p>
      </section>`;
    el.querySelector('#key-form').addEventListener('submit', (e) => {
      e.preventDefault();
      setApiKey(e.target.elements.key.value);
      render();
    });
  }

  const scrollDown = () => requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));

  async function send(text) {
    const q = text.trim();
    if (!q || busy) return;
    busy = true;
    history.push({ role: 'user', text: q });
    render();
    const chat = el.querySelector('#chat');
    const bubble = document.createElement('div');
    bubble.className = 'msg model pending';
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    chat.appendChild(bubble);
    scrollDown();
    controller = new AbortController();
    try {
      // データの読み込みは1分間使い回す
      if (!context || Date.now() - contextAt > 60_000) {
        context = await buildContext(store);
        contextAt = Date.now();
      }
      const answer = await ask(history, context, (partial) => {
        bubble.classList.remove('pending');
        bubble.innerHTML = format(partial);
        scrollDown();
      }, controller.signal);
      history.push({ role: 'model', text: answer || '（返答がありませんでした）' });
    } catch (err) {
      console.error(err);
      const msg = errorMessage(err);
      history.pop();
      if (msg) {
        bubble.classList.remove('pending');
        bubble.classList.add('error');
        bubble.textContent = msg;
      }
      busy = false;
      saveHistory(history);
      el.querySelector('#ask button').disabled = false;
      el.querySelector('#ask textarea').value = q;
      return;
    }
    busy = false;
    saveHistory(history);
    render();
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'back') navigate('home');
    if (t.dataset.act === 'suggest') send(t.textContent);
    if (t.dataset.act === 'reset') {
      controller?.abort();
      history = [];
      busy = false;
      context = null;
      saveHistory(history);
      render();
    }
  });

  render();
  return () => controller?.abort();
}
