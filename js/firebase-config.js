// Firebaseコンソール > プロジェクトの設定 > マイアプリ（ウェブ）の値に置き換えてください。
// この値は公開されても問題ありません（アクセス制御は firestore.rules で行います）。
export const firebaseConfig = {
  apiKey: 'AIzaSyAL6Zd2i9LNonN3ks2p3Bccy4RYZmGd7Kw',
  authDomain: 'kakarituke.firebaseapp.com',
  projectId: 'kakarituke',
  storageBucket: 'kakarituke.firebasestorage.app',
  messagingSenderId: '902476496508',
  appId: '1:902476496508:web:82e72798768183f29193f9',
};

// データの保存場所。既存の Firebase プロジェクトを他のアプリと共用しても
// データが混ざらないよう、すべて apps/randk の下に保存する。
export const dataRoot = ['apps', 'randk'];
