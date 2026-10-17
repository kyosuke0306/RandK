import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  writeBatch, runTransaction, serverTimestamp, query, where, orderBy, limit, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, dataRoot } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// オフラインでも表示できるようにローカルキャッシュを有効化
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// アプリ用の領域（dataRoot）の下のコレクション・ドキュメントを指す
export const col = (...segs) => collection(db, ...dataRoot, ...segs);
export const ref = (...segs) => doc(db, ...dataRoot, ...segs);

export const isConfigured = !firebaseConfig.apiKey.startsWith('YOUR_');

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export {
  signOut, onAuthStateChanged,
  collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  writeBatch, runTransaction, serverTimestamp, query, where, orderBy, limit, increment,
};
