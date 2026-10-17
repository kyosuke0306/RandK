import {
  auth, db, isConfigured, signInWithGoogle, signOut, onAuthStateChanged,
  col, ref, onSnapshot, setDoc, serverTimestamp,
} from './firebase.js';
import { icon, googleLogo } from './icons.js';
import { esc, toast } from './util.js';
import * as moneyView from './views/money.js';
import * as settingsView from './views/settings.js';

// 画面（タブ）の一覧。機能を増やすときはここに追加する。
const VIEWS = [
  { id: 'money', label: 'お金', icon: 'wallet', view: moneyView },
  { id: 'settings', label: '設定', icon: 'settings', view: settingsView },
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
let currentView = location.hash.slice(1) || 'money';

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

function renderLogin() {
  root.innerHTML = `
    <div class="center-screen">
      <div class="logo-mark">${icon('heart', 32)}</div>
      <h1>ふたりの家計</h1>
      <p class="muted">家賃や光熱費の支払いを2人で共有</p>
      <button class="btn btn-google" id="login">${googleLogo}<span>Googleでログイン</span></button>
    </div>`;
  root.querySelector('#login').addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') toast(`ログインに失敗しました (${e.code})`);
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
      ${VIEWS.map((v) => `
        <button class="tab" data-view="${v.id}">
          ${icon(v.icon, 22)}<span>${v.label}</span>
        </button>`).join('')}
    </nav>`;
  root.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => showView(b.dataset.view));
  });
  showView(currentView);
}

function showView(id) {
  const entry = VIEWS.find((v) => v.id === id) || VIEWS[0];
  currentView = entry.id;
  history.replaceState(null, '', `#${entry.id}`);
  root.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === entry.id);
  });
  unmountView?.();
  const container = root.querySelector('#view');
  container.innerHTML = '';
  window.scrollTo(0, 0);
  unmountView = entry.view.mount(container, { store, db });
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
