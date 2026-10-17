import { auth, signOut, ref, setDoc } from '../firebase.js';
import { icon } from '../icons.js';
import { esc, toast } from '../util.js';
import {
  getApiKey, setApiKey, getModel, setModel, DEFAULT_MODEL,
} from '../gemini.js';

export function mount(el, { store, navigate }) {
  function render() {
    const me = store.member(store.user.uid);
    const members = store.memberList();
    const partner = members.find((m) => m.uid !== store.user.uid);
    const shares = store.settings.shares || {};
    let myShare = 50;
    if (shares[store.user.uid] != null) myShare = shares[store.user.uid];
    else if (partner && shares[partner.uid] != null) myShare = 100 - shares[partner.uid];

    el.innerHTML = `
      <header class="page-head row">
        <button class="icon-btn back" data-back aria-label="トップに戻る">${icon('chevronLeft')}</button>
        <h1>設定</h1>
      </header>

      <section class="card">
        <h2>自分の表示名</h2>
        <form class="inline-form" id="name-form">
          <input name="name" value="${esc(me?.name || '')}" maxlength="20" required>
          <button class="btn btn-primary">保存</button>
        </form>
        <p class="label">${esc(store.user.email)}</p>
      </section>

      <section class="card">
        <h2>負担の割合</h2>
        ${partner ? `
          <div class="ratio">
            <div class="ratio-labels">
              <span><span class="dot tone-${me?.tone}"></span>${esc(me?.name)} <strong id="r-me">${myShare}%</strong></span>
              <span><strong id="r-partner">${100 - myShare}%</strong> ${esc(partner.name)}<span class="dot tone-${partner.tone}"></span></span>
            </div>
            <input type="range" id="ratio" min="0" max="100" step="5" value="${myShare}">
          </div>
          <p class="label">精算額の計算に使います。変更は相手にもすぐ反映されます。</p>
        ` : '<p class="muted">パートナーがログインすると設定できます。</p>'}
      </section>

      <section class="card">
        <h2>メンバー</h2>
        <ul class="member-list">
          ${members.map((m) => `
            <li>
              ${m.photoURL ? `<img src="${esc(m.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar tone-${m.tone}">${icon('users', 18)}</span>`}
              <span><strong>${esc(m.name)}</strong>${m.uid === store.user.uid ? ' <small class="muted">（自分）</small>' : ''}<br><small class="muted">${esc(m.email)}</small></span>
            </li>`).join('')}
        </ul>
      </section>

      <section class="card">
        <h2>AIに質問（Gemini）</h2>
        <form class="gemini-form" id="gemini-form">
          <label class="field">
            <span>APIキー（このスマホにだけ保存）</span>
            <input name="key" type="password" value="${esc(getApiKey())}" placeholder="AIza..." autocomplete="off">
          </label>
          <label class="field">
            <span>モデル</span>
            <input name="model" value="${esc(getModel())}" placeholder="${DEFAULT_MODEL}" autocomplete="off">
          </label>
          <button class="btn btn-primary">保存</button>
        </form>
        <p class="label">キーは <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> で作れます。質問するときは、アプリのデータが Google の Gemini に送られます。</p>
      </section>

      <button class="btn btn-ghost full" id="logout">${icon('logout', 18)}<span>ログアウト</span></button>`;

    el.querySelector('#name-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.target.elements.name.value.trim();
      if (!name) return;
      await setDoc(ref('members', store.user.uid), { name }, { merge: true })
        .then(() => toast('保存しました'))
        .catch((err) => toast(`保存に失敗しました (${err.code})`));
    });

    const range = el.querySelector('#ratio');
    range?.addEventListener('input', () => {
      el.querySelector('#r-me').textContent = `${range.value}%`;
      el.querySelector('#r-partner').textContent = `${100 - range.value}%`;
    });
    range?.addEventListener('change', async () => {
      const v = Number(range.value);
      await setDoc(ref('settings', 'main'), {
        shares: { [store.user.uid]: v, [partner.uid]: 100 - v },
      }, { merge: true }).catch((err) => toast(`保存に失敗しました (${err.code})`));
    });

    el.querySelector('#gemini-form').addEventListener('submit', (e) => {
      e.preventDefault();
      setApiKey(e.target.elements.key.value);
      setModel(e.target.elements.model.value || DEFAULT_MODEL);
      toast(getApiKey() ? '保存しました' : 'APIキーを削除しました');
    });
    el.querySelector('#logout').addEventListener('click', () => signOut(auth));
    el.querySelector('[data-back]').addEventListener('click', () => navigate('home'));
  }

  render();
  // 入力中に相手の更新で書き換わらないよう、フォーカス中は再描画しない
  return store.subscribe(() => {
    if (!el.contains(document.activeElement) || document.activeElement === document.body) render();
  });
}
