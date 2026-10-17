# ふたりの家計

同棲カップル2人専用の家計共有アプリ。家賃・光熱費の金額と支払い状況を共有し、月ごとの精算額を自動で計算します。

- Googleアカウントでログイン（許可した2人だけが使える）
- 片方が編集すると、もう片方の画面にも即座に反映（Firestore のリアルタイム同期）
- **家計簿**: 毎月 家賃・電気代・ガス代・水道代 を自動で用意。金額、どっちが払ったか、支払済み・精算済みを記録し、2人で割った金額と精算額を表示
- **買い物リスト**: 買いたいものをメモして、買ったらチェック
- **写真**: アプリで撮った写真がそのまま2人で見られる（縮小して Firestore に保存。Firebase Storage は不要）
- **予定**: カレンダーに2人の予定を入れる
- ビルドなしの静的サイト。GitHub Pages でそのまま公開できる

## セットアップ

### 1. Firebase プロジェクトを用意する

新しく作っても、**すでにある別のプロジェクトを使い回しても** 大丈夫です（プロジェクト数の上限に達している場合は使い回してください）。
このアプリのデータはすべて `apps/randk/` の下（`js/firebase-config.js` の `dataRoot` で変更可）。

```
apps/randk/members/{uid}                 名前・メール（ログイン時に自動登録）
apps/randk/settings/main                 shares: { uid: 負担割合% }
apps/randk/months/{YYYY-MM}              initialized: その月の項目を作成済みか
apps/randk/months/{YYYY-MM}/bills/{id}   category, name, amount, dueDate, payer, paid, settled, note
apps/randk/shopping/{id}                 text, done, createdBy
apps/randk/photos/{id}                   thumb（一覧用の小さい画像）, caption, createdBy, createdMs
apps/randk/photoData/{id}                data（拡大表示用の画像、1600px 程度の JPEG）
apps/randk/events/{id}                   title, date, time, endTime, place, note, createdBy
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
js/views/money.js       家計簿（支払い一覧・精算）
js/views/shopping.js    買い物リスト
js/views/photos.js      写真
js/views/calendar.js    予定（カレンダー）
js/views/settings.js    設定（トップ画面右上から開く）
scripts/stamp.py        公開前に実行するキャッシュ対策
firestore.rules         セキュリティルール
```

## 機能を追加するには

`js/views/` に `mount(el, { store, db, navigate })` を持つファイルを作り、`js/app.js` の `VIEWS` に1行追加すると、下のタブとトップ画面のメニューに並びます。
データは `col('memos')` のように `js/firebase.js` の `col` / `ref` で保存すれば `apps/randk/` の下に入り、`firestore.rules` はそのまま2人だけに制限されます。
