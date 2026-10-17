# FUTARI（RandK）

カップル2人用の家計共有アプリ。ビルドなしの静的サイト（ES Modules）+ Firebase（Google ログイン・Firestore）。
GitHub Pages（`main` / root）で https://kyosuke0306.github.io/RandK/ に公開している。

## 修正を反映するとき（ユーザーの指示）

修正してテストが通ったら、確認を取らずに `main` へ反映して公開する。

1. `python3 scripts/stamp.py` を実行する（JS/CSS の URL にハッシュを付けてキャッシュを回避。忘れると古い版が表示される）
2. `main` にコミットして `git push origin main`
3. 公開URLで新しいファイルが配信されたか確認する

## 決まりごと

- UI は日本語。絵文字は使わず、アイコンは `js/icons.js` の SVG を使う
- Firestore のデータはすべて `apps/randk/` の下（`js/firebase.js` の `col` / `ref` を使う）。Firebase プロジェクト `kakarituke` を他アプリと共用しているため
- 本物のメールアドレスをリポジトリに書かない（`firestore.rules` は見本。実際のルールは Firebase コンソールで管理）
- 画面は ホーム / 家計簿 / 買い物 / 写真 / 予定（下のタブ）と 設定（`tab: false`、ホーム右上から）
- 写真は Firebase Storage（Blaze プラン必須）を使わず、縮小して Firestore の `photos`（サムネイル）と `photoData`（拡大用）に保存している。領収書も同じ方式で `receipts` / `receiptData`（処理は `js/image.js`）
- 金額の入力はテキスト入力を使わず、家計簿のテンキー（`openKeypad`）で入力する
- 新しい機能は `js/views/` に `mount(el, { store, db, views, navigate })` を作り、`js/app.js` の `VIEWS` に追加する
