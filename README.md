# ふたりの家計

同棲カップル2人専用の家計共有アプリ。家賃・光熱費の金額と支払い状況を共有し、月ごとの精算額を自動で計算します。

- Googleアカウントでログイン（許可した2人だけが使える）
- 片方が編集すると、もう片方の画面にも即座に反映（Firestore のリアルタイム同期）
- 月ごとに家賃・電気・ガス・水道・ネットなどを管理
- 誰が払ったか、期限、メモを記録
- 負担割合（50:50 など）から「誰が誰にいくら払えば精算完了か」を表示
- 先月の項目をコピー（家賃とネットは金額も引き継ぎ）
- ビルドなしの静的サイト。GitHub Pages でそのまま公開できる

## セットアップ

### 1. Firebase プロジェクトを作る

1. https://console.firebase.google.com/ で「プロジェクトを追加」
2. **Authentication** → 始める → ログイン方法で **Google** を有効化
3. **Firestore Database** → データベースを作成（本番環境モード、リージョンは `asia-northeast1` など）
4. プロジェクトの設定 → マイアプリ → ウェブアプリ（`</>`）を追加し、表示された `firebaseConfig` をコピー

### 2. 設定値を入れる

`js/firebase-config.js` の値を、コピーした `firebaseConfig` に置き換えます。
（この値は公開リポジトリに置いても問題ありません。データは下のルールで守られます）

### 3. 2人だけが使えるようにする

`firestore.rules` のメールアドレスを、2人の Google アカウントに書き換えます。

```
request.auth.token.email in [
  'you@gmail.com',
  'partner@gmail.com'
];
```

Firebase コンソール → Firestore Database → **ルール** タブに `firestore.rules` の中身を貼り付けて「公開」。
ここに書かれていないアカウントでログインすると「このアカウントは使えません」と表示され、データは読み書きできません。

### 4. GitHub Pages で公開

1. GitHub のリポジトリ → Settings → Pages
2. Source: **Deploy from a branch**、Branch: `main` / `/ (root)` を選んで保存
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます
4. Firebase コンソール → Authentication → 設定 → **承認済みドメイン** に `<ユーザー名>.github.io` を追加

スマホではブラウザの「ホーム画面に追加」でアプリのように使えます。

## ローカルで動かす

ES Modules を使っているので、ファイルを直接開くのではなくローカルサーバーで開きます。

```sh
python3 -m http.server 8000
# http://localhost:8000 を開く
```

`localhost` は Firebase の承認済みドメインに最初から入っています。

## データ構造（Firestore）

```
members/{uid}                 名前・メール（ログイン時に自動登録）
settings/main                 shares: { uid: 負担割合% }
months/{YYYY-MM}              settled: 精算済みかどうか
months/{YYYY-MM}/bills/{id}   category, name, amount, dueDate, payer, paid, note, updatedBy, updatedAt
```

## ファイル構成

```
index.html
css/style.css
js/app.js               ログイン・画面切り替え・共有状態
js/firebase.js          Firebase SDK の読み込み
js/firebase-config.js   Firebase の設定値
js/icons.js             SVG アイコン
js/util.js
js/views/money.js       お金（支払い一覧・精算）
js/views/settings.js    設定
firestore.rules         セキュリティルール
```

## 機能を追加するには

`js/views/` に `mount(el, { store, db })` を持つファイルを作り、`js/app.js` の `VIEWS` に1行追加すると下のタブに並びます。
データは Firestore の新しいコレクション（例: `memos`）に保存すれば、`firestore.rules` はそのまま2人だけに制限されます。
