// Firebaseコンソール > プロジェクトの設定 > マイアプリ（ウェブ）の値に置き換えてください。
// この値は公開されても問題ありません（アクセス制御は firestore.rules で行います）。
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// データの保存場所。既存の Firebase プロジェクトを他のアプリと共用しても
// データが混ざらないよう、すべて apps/randk の下に保存する。
export const dataRoot = ['apps', 'randk'];
