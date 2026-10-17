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

### 1. Firebase プロジェクトを用意する

新しく作っても、**すでにある別のプロジェクトを使い回しても** 大丈夫です（プロジェクト数の上限に達している場合は使い回してください）。
このアプリのデータはすべて `apps/randk/` の下に保存されるので、同じプロジェクトにある他のアプリのデータとは混ざりません。

1. https://console.firebase.google.com/ で使うプロジェクトを開く（または作る）
2. **Authentication** → ログイン方法で **Google** を有効化（すでに有効ならそのまま）
3. **Firestore Database** がまだなければ作成（本番環境モード、リージョンは `asia-northeast1` など）
4. プロジェクトの設定 → マイアプリ → ウェブアプリ（`</>`）を追加し、表示された `firebaseConfig` をコピー
   （既存プロジェクトでも、このアプリ用にウェブアプリを1つ追加するのがおすすめ）

### 2. 設定値を入れる

`js/firebase-config.js` の値を、コピーした `firebaseConfig` に置き換えます。
（この値は公開リポジトリに置いても問題ありません。データは下のルールで守られます）

### 3. 2人だけが使えるようにする

`firestore.rules` のメールアドレスを、2人の Google アカウントに書き換えます。

Firebase コンソール → Firestore Database → **ルール** タブで:

- **新しいプロジェクトの場合**: `firestore.rules` の中身をそのまま貼り付けて「公開」
- **既存プロジェクトの場合**: 既存のルールは消さず、`ふたりの家計` の `match /apps/randk/{document=**} { ... }` ブロックだけを `match /databases/{database}/documents { ... }` の中に追加して「公開」

ここに書かれていないアカウントでログインすると「このアカウントは使えません」と表示され、データは読み書きできません。

> 既存ルールに `match /{document=**} { allow read, write: if request.auth != null; }` のような「ログインしていれば全部OK」のルールがあると、
> もう一方のアプリのユーザーにもこのアプリのデータが見えてしまいます（ルールはどれか1つでも許可すれば通るため）。
> その場合は既存ルールをそのアプリのコレクションだけに絞ってください。

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

すべて `apps/randk/` の下（`js/firebase-config.js` の `dataRoot` で変更可）。

```
apps/randk/members/{uid}                 名前・メール（ログイン時に自動登録）
apps/randk/settings/main                 shares: { uid: 負担割合% }
apps/randk/months/{YYYY-MM}              settled: 精算済みかどうか
apps/randk/months/{YYYY-MM}/bills/{id}   category, name, amount, dueDate, payer, paid, note, updatedBy, updatedAt
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
js/views/home.js        トップ画面（今月の状況・これからの支払い・メニュー）
js/views/money.js       お金（支払い一覧・精算）
js/views/settings.js    設定
firestore.rules         セキュリティルール
```

## 機能を追加するには

`js/views/` に `mount(el, { store, db, navigate })` を持つファイルを作り、`js/app.js` の `VIEWS` に1行追加すると、下のタブとトップ画面のメニューに並びます。
データは `col('memos')` のように `js/firebase.js` の `col` / `ref` で保存すれば `apps/randk/` の下に入り、`firestore.rules` はそのまま2人だけに制限されます。
