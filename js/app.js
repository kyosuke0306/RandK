import {
  auth, db, isConfigured, signInWithGoogle, signOut, onAuthStateChanged,
  col, ref, onSnapshot, setDoc, serverTimestamp,
} from './firebase.js';
import { icon, googleLogo } from './icons.js';
import { esc, toast } from './util.js';
import * as homeView from './views/home.js';
import * as moneyView from './views/money.js';
import * as shoppingView from './views/shopping.js';
import * as photosView from './views/photos.js';
import * as calendarView from './views/calendar.js';
import * as todoView from './views/todo.js';
import * as askView from './views/ask.js';
import * as settingsView from './views/settings.js';

// 画面（タブ）の一覧。機能を増やすときはここに追加する。
const VIEWS = [
  { id: 'home', label: 'ホーム', icon: 'home', view: homeView },
  { id: 'money', label: '家計簿', icon: 'wallet', desc: '家賃・光熱費の支払いと精算', view: moneyView },
  { id: 'todo', label: 'TODO', icon: 'listCheck', desc: '2人のやること', view: todoView },
  { id: 'shopping', label: '買い物', icon: 'cart', desc: '買いたいものをメモ', view: shoppingView },
  { id: 'photos', label: '写真', icon: 'camera', desc: '撮った写真を2人で見る', view: photosView },
  { id: 'calendar', label: '予定', icon: 'calendar', desc: '2人で遊ぶ予定', view: calendarView },
  // tab: false は下のタブに出さない（トップ画面から開く）
  { id: 'ask', label: '質問', icon: 'sparkle', desc: 'アプリの情報をAIに聞く', view: askView, tab: false },
  { id: 'settings', label: '設定', icon: 'settings', desc: '表示名・負担の割合', view: settingsView, tab: false },
];

const root = document.getElementById('app');

// 2人で共有する状態。members と settings はリアルタイムに同期される。
export const store = {
  user: null,
  members: {},
  settings: {},
  listeners: new Set(),
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit() {
    this.listeners.forEach((fn) => fn());
  },
  memberList() {
    return Object.entries(this.members)
      .map(([uid, m]) => ({ uid, ...m }))
      .sort((a, b) => a.uid.localeCompare(b.uid))
      .map((m, i) => ({ ...m, tone: i === 0 ? 'a' : 'b' }));
  },
  member(uid) {
    return this.memberList().find((m) => m.uid === uid);
  },
  name(uid) {
    return this.member(uid)?.name || '未設定';
  },
};

let unsubs = [];
let unmountView = null;
const viewFromHash = () => location.hash.slice(1) || 'home';

function cleanup() {
  unsubs.forEach((u) => u());
  unsubs = [];
  unmountView?.();
  unmountView = null;
  store.listeners.clear();
  store.members = {};
  store.settings = {};
}

function renderSetupNeeded() {
  root.innerHTML = `
    <div class="center-screen">
      <div class="logo-mark">${icon('lock', 32)}</div>
      <h1>Firebaseの設定が必要です</h1>
      <p class="muted">js/firebase-config.js に Firebase プロジェクトの設定値を入力してください。手順は README.md にあります。</p>
    </div>`;
}

function renderLoading() {
  root.innerHTML = '<div class="center-screen"><div class="spinner"></div></div>';
}

// LINE・Instagram などのアプリ内ブラウザでは Google ログインが使えない
const inAppBrowser = (() => {
  const ua = navigator.userAgent;
  if (/\bLine\//i.test(ua)) return 'LINE';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/Twitter/i.test(ua)) return 'X';
  if (/KAKAOTALK/i.test(ua)) return 'KakaoTalk';
  if (/; wv\)/.test(ua)) return 'アプリ';
  return null;
})();

// LINE は URL に openExternalBrowser=1 を付けると Safari / Chrome で開き直してくれる
if (inAppBrowser === 'LINE' && !location.search.includes('openExternalBrowser')) {
  location.replace(`${location.pathname}?openExternalBrowser=1${location.hash}`);
}

function renderInAppWarning() {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const browser = isIOS ? 'Safari' : 'Chrome';
  const url = `${location.origin}${location.pathname}`;
  return `
    <div class="card inapp">
      <p><strong>${inAppBrowser}の中のブラウザではログインできません</strong></p>
      <p class="muted">右上か右下のメニュー（${icon('more', 16, 'inline')}）から「${browser}で開く」「ブラウザで開く」を選ぶか、下のボタンでリンクをコピーして ${browser} に貼り付けてください。</p>
      <button class="btn" id="copy-url">${icon('copy', 18)}<span>リンクをコピー</span></button>
      <p class="label url">${esc(url)}</p>
    </div>`;
}

function renderLogin() {
  root.innerHTML = `
    <div class="center-screen">
      <div class="logo-mark">${icon('heart', 32)}</div>
      <h1 class="wordmark">FUTARI</h1>
      <p class="muted">家計簿・買い物・写真・予定を2人で共有</p>
      ${inAppBrowser ? renderInAppWarning() : ''}
      <button class="btn btn-google" id="login">${googleLogo}<span>Googleでログイン</span></button>
    </div>`;
  root.querySelector('#copy-url')?.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('リンクをコピーしました');
    } catch {
      prompt('このリンクをコピーしてください', url);
    }
  });
  root.querySelector('#login').addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      if (e.code === 'auth/popup-blocked') {
        toast('ポップアップがブロックされました。ブラウザの設定で許可してください');
        return;
      }
      toast(`ログインに失敗しました (${e.code})`);
    }
  });
}

function renderDenied(user) {
  root.innerHTML = `
    <div class="center-screen">
      <div class="logo-mark warn">${icon('lock', 32)}</div>
      <h1>このアカウントは使えません</h1>
      <p class="muted">${esc(user.email)} は許可されていません。<br>firestore.rules の許可リストにメールアドレスを追加してください。</p>
      <button class="btn" id="logout">別のアカウントでログイン</button>
    </div>`;
  root.querySelector('#logout').addEventListener('click', () => signOut(auth));
}

function renderShell() {
  root.innerHTML = `
    <main id="view" class="view"></main>
    <nav class="tabbar">
      ${VIEWS.filter((v) => v.tab !== false).map((v) => `
        <button class="tab" data-view="${v.id}">
          ${icon(v.icon, 22)}<span>${v.label}</span>
        </button>`).join('')}
    </nav>`;
  root.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.view));
  });
  showView(viewFromHash());
}

// 画面を移動する。履歴に残るので、スマホの「戻る」で前の画面に戻れる。
function navigate(id) {
  if (viewFromHash() === id) showView(id);
  else location.hash = id;
}

window.addEventListener('hashchange', () => {
  if (root.querySelector('#view')) showView(viewFromHash());
});

function showView(id) {
  const entry = VIEWS.find((v) => v.id === id) || VIEWS[0];
  root.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === entry.id);
  });
  unmountView?.();
  // 前の画面のイベントが残らないよう、毎回新しい要素に差し替える
  const container = document.createElement('main');
  container.id = 'view';
  container.className = 'view';
  root.querySelector('#view').replaceWith(container);
  window.scrollTo(0, 0);
  unmountView = entry.view.mount(container, { store, db, views: VIEWS, navigate });
}

async function start(user) {
  renderLoading();
  store.user = user;
  try {
    // 自分のメンバー情報を登録（許可されていないアカウントはここで弾かれる）
    await setDoc(ref('members', user.uid), {
      email: user.email,
      photoURL: user.photoURL || null,
      lastLoginAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    if (e.code === 'permission-denied') return renderDenied(user);
    toast(`接続に失敗しました (${e.code})`);
    return;
  }

  const loaded = { members: false, settings: false };
  let shown = false;
  const update = (key) => {
    loaded[key] = true;
    if (shown) return store.emit();
    if (loaded.members && loaded.settings) {
      shown = true;
      renderShell();
    }
  };

  unsubs.push(onSnapshot(col('members'), (snap) => {
    store.members = {};
    snap.forEach((d) => {
      const m = d.data();
      store.members[d.id] = { ...m, name: m.name || m.email?.split('@')[0] || '未設定' };
    });
    // 名前未設定ならGoogleの表示名を初期値にする
    if (!snap.docs.find((d) => d.id === user.uid)?.data().name && user.displayName) {
      setDoc(ref('members', user.uid), { name: user.displayName }, { merge: true });
    }
    update('members');
  }));

  unsubs.push(onSnapshot(ref('settings', 'main'), (snap) => {
    store.settings = snap.data() || {};
    update('settings');
  }));
}

if (!isConfigured) {
  renderSetupNeeded();
} else {
  renderLoading();
  onAuthStateChanged(auth, (user) => {
    cleanup();
    if (user) start(user);
    else renderLogin();
  });
}
