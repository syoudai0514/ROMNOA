# ROMNOA 正本設計

## 構成

React 19 / TypeScript / Vite / Tailwind CSS 4。Vercel Node.js 24の `GET /api/articles`・`GET /api/reader?article=<記事ID>` とUIを分離する。外部DB・ユーザー登録・AI・広告SDKは導入しない。個人用プレビューをVercel Authenticationで保護する。

`server/sources.ts` → 安全なRSS取得 → XMLパーサー → 正規化・重複排除 → JSON API → React → localStorage。

画面: ホーム（検索・並び順・カテゴリ・記事）、カテゴリ（件数と選択）、保存（お気に入り/履歴）、設定（配信元・NGワード・文字・テーマ・PWA案内）。記事タップで本文リーダーを開き、出典・保存・既読・前後移動を提供する。本文はテキストブロックと検証した記事画像URLの配列へ変換し、元のHTMLは描画しない。

本文はアプリ内に表示し、画像は表示ボタンを押すまで読み込まない。元記事とSafari案内は折りたたんだ補助導線に置く。取得失敗時はエラー・再試行を表示し、外部サイトへ自動遷移しない。一般公開の全文再配信許諾は未確認。個人用Previewに限定する（ADR 003）。

## データ

Article: id（正規化URL）、url、sourceId、title、publishedAt（不明はnull）、category。一覧APIには本文を含めない。FeedResult: 記事、ソースごとのstatus/取得日時、generatedAt。ReaderDocument: articleId、sourceId、title、url、fetchedAt、blocks（text/image）。画像はlivedoor.blogimg.jpの各サイト固有フォルダにある画像形式だけ許可する。

端末保存v1: お気に入りのメタデータ（最大200件）、既読/履歴（500件）、テーマ、文字サイズ、NGワード、非表示配信元、表示位置。Zodによる復元時検証、破損時の復旧と書込失敗時の通知。記事キャッシュは24時間、設定とは別キー。容量不足でもアプリ操作は継続する。

本文は別のIndexedDB `romnoa-reader/articles` に最大100件・24時間保持する。既存の保存・履歴スキーマは変えない。取得済み本文は再起動・オフライン時も利用できる。画像のバイナリは保存しない。本文キャッシュの欠落/破損/書込拒否でも表示を継続し、未保存の本文をオフラインで開く場合は取得不可と説明する。

## 安全性と取得負荷

- 一覧APIは固定HTTPSフィードのみでクエリを拒否。本文APIは現在のRSSに実在する数値記事パスだけを許可し、任意URLを取得しない。リダイレクトは両APIで拒否。
- 6秒タイムアウト、展開後1MB上限をstreamで強制。DOCTYPE/ENTITY拒否、XML構文検証、entity展開無効。フィードからのリンクも配信元ホストに限定。
- htmlparser2でタイトル・本文を解析しReactの文字列で表示。本文ルートはハムスター速報 `article-body-inner/article-body-more`、アルファルファ `article_body/article_bodymore` に固定。見つからない場合にページ全体へフォールバックしない。script/style/iframe/video/広告欄/関連記事等を捨てる。dangerouslySetInnerHTMLは使わない。
- 正常/失敗とも次回アクセスを10分抑制。Vercel Runtime Cacheに最終正常データを24時間保持。ローカル開発だけメモリを利用。同一プロセスの同時取得はまとめる。Runtime Cacheは分散ロックではないため複数インスタンスの同時cold missは発生し得る。
- CDNは成功/部分成功を10分キャッシュ、最大1日stale。全件失敗は503/no-storeにして最後のブラウザキャッシュを利用。
- 本文取得: 10秒・展開後2MB・深さ120・本文10万文字・画像24件・ブロック600件まで。同時取得をまとめ、正常本文を24時間、取得失敗を1分キャッシュする。本文APIはprivate/no-storeでCDNへ配信せず、Runtime Cache内だけで再利用する。
- 検索・配信元選択はブラウザ処理。同じAPIパスを共有してキャッシュ分断を防ぐ。
- 外部画像の自動読込・iframe・外部scriptなし。画像は明示操作後のみ許可CDNから読込。CSPは同一オリジンとその画像CDNに限定。元記事は補助リンクの明示操作で別タブに開く。

## 重複と順序

追跡パラメータ/fragment除去・HTTPS正規化で同一記事を識別。類似タイトルは文字bigramのDice係数0.88以上かつ24時間以内の場合にのみ表示時に折り畳み、展開できる。断定的な同一記事認定や人気スコアには使わない。検索結果は取得済み記事内だけ。カテゴリはRSS分類とタイトルのルールベース推定で正確性を保証しない。

## PWA

Service Workerでアプリシェルをprecache。APIはSWでキャッシュせず、検証後の端末キャッシュを使用。更新は通知して明示的に切り替える。iOSはSafari共有メニューから「ホーム画面に追加」。一覧とアプリ内本文のスクロール位置を復元する。外部サイトを任意に開いた場合の位置は管理しない。
