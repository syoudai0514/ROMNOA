# ROMNOA 正本設計

## 構成

React 19 / TypeScript / Vite / Tailwind CSS 4。Vercel Node.js 24の `GET /api/articles`・`GET /api/reader?article=<記事ID>[&from=<元記事ID>]` とUIを分離する。外部DB・ユーザー登録・AI・広告SDKは導入しない。個人用プレビューをVercel Authenticationで保護する。

`server/sources.ts` → 安全なRSS取得 → XMLパーサー → 正規化・重複排除 → JSON API → React → localStorage。

画面: ホーム（検索・並び順・カテゴリ・記事）、カテゴリ（件数と選択）、保存（お気に入り/履歴）、設定（配信元・NGワード・文字・テーマ・PWA案内）。記事タップで本文リーダーを開き、出典・保存・既読・前後移動を提供する。本文はテキスト/画像のブロックと検証したリンクへ変換し、元のHTMLは描画しない。対応動画はリンクから導く。

画像優先: 記事を開いたら選別した記事画像を表示し、タップで拡大。本文は「本文も読む」で開く（画像・動画なしなら本文を初期表示）。関連記事のタイトルとサムネイルを別領域に置き、アプリ内で連続閲覧・元記事へ戻る。元記事とSafari案内は折りたたんだ補助導線に置く。取得失敗時はエラー・再試行を表示し、外部サイトへ自動遷移しない。一般公開の全文再配信許諾は未確認。個人用Previewに限定する（ADR 003）。

## データ

Article: id（正規化URL）、url、sourceId、title、publishedAt（不明はnull）、category。一覧APIには本文を含めない。FeedResult: 記事、ソースごとのstatus/取得日時、generatedAt。ReaderDocument: articleId、sourceId、title、url、fetchedAt、schemaVersion=3、blocks（text/image）、imageAudit（広告等の除外/不明/別記事の画像数）、related（Articleとthumbnail）。画像はlivedoor.blogimg.jpのサイト固有フォルダ、pbs.twimg.com/media/、Imgur単一画像とInstagram CDNの検証済みURLだけ許可する。動画はlinksから派生する（ADR 007）。

端末保存v1: お気に入りのメタデータ（最大200件）、既読/履歴（500件）、テーマ、文字サイズ、NGワード、非表示配信元、表示位置。Zodによる復元時検証、破損時の復旧と書込失敗時の通知。記事キャッシュは24時間、設定とは別キー。容量不足でもアプリ操作は継続する。

本文は別のIndexedDB `romnoa-reader/articles` に最大100件・24時間保持する。既存の保存・履歴スキーマは変えない。取得済み本文は再起動・オフライン時も利用できる。画像のバイナリは保存しない。本文キャッシュの欠落/破損/書込拒否でも表示を継続し、未保存の本文をオフラインで開く場合は取得不可と説明する。

## 安全性と取得負荷

- 一覧APIは固定HTTPSフィードのみでクエリを拒否。本文APIは現在のRSSに実在する数値記事パスだけを許可し、任意URLを取得しない。リダイレクトは両APIで拒否。
- 6秒タイムアウト、展開後1MB上限をstreamで強制。DOCTYPE/ENTITY拒否、XML構文検証、entity展開無効。フィードからのリンクも配信元ホストに限定。
- htmlparser2でタイトル・本文を解析しReactの文字列で表示。本文ルートはハムスター速報 `article-body-inner/article-body-more`、アルファルファ `article_body/article_bodymore` に固定。見つからない場合にページ全体へフォールバックしない。script/style/iframe/広告欄/関連記事と元のvideo HTMLを捨てる。許可動画URLだけを別途抽出しネイティブ再生する（ADR 007）。dangerouslySetInnerHTMLは使わない。
- 正常/失敗とも次回アクセスを10分抑制。Vercel Runtime Cacheに最終正常データを24時間保持。ローカル開発だけメモリを利用。同一プロセスの同時取得はまとめる。Runtime Cacheは分散ロックではないため複数インスタンスの同時cold missは発生し得る。
- CDNは成功/部分成功を10分キャッシュ、最大1日stale。全件失敗は503/no-storeにして最後のブラウザキャッシュを利用。
- 本文取得: 10秒・展開後2MB・深さ120・本文10万文字・画像80件・ブロック600件まで。同時取得をまとめ、正常本文を24時間、取得失敗を1分キャッシュする。本文APIはprivate/no-storeでCDNへ配信せず、Runtime Cache内だけで再利用する。
- 検索・配信元選択はブラウザ処理。同じAPIパスを共有してキャッシュ分断を防ぐ。
- 広告/未判定画像・iframe・外部scriptなし。画像は許可CDNとサイト固有フォルダを検証し、記事/関連記事を分けて読込。CSPは同一オリジンと検証済み画像・動画CDNに限定。元記事は補助リンクの明示操作で別タブに開く。

## 重複と順序

追跡パラメータ/fragment除去・HTTPS正規化で同一記事を識別。類似タイトルは文字bigramのDice係数0.88以上かつ24時間以内の場合にのみ表示時に折り畳み、展開できる。断定的な同一記事認定や人気スコアには使わない。検索結果は取得済み記事内だけ。カテゴリはRSS分類とタイトルのルールベース推定で正確性を保証しない。

## PWA

Service Workerでアプリシェルをprecache。APIはSWでキャッシュせず、検証後の端末キャッシュを使用。更新はautoUpdate/skipWaitingで反映し、登録時にも更新を確認する。iOSはSafari共有メニューから「ホーム画面に追加」。一覧とアプリ内本文のスクロール位置を復元する。外部サイトを任意に開いた場合の位置は管理しない。

## 画像分類と関連記事の認可（ADR 004）

本文の固定ルート内で画像を抽出する。広告/非表示/affiliate/sponsored要素、小さな追跡画像を除外。既知の記事パスへのリンク画像は別記事として扱い、本文画像へ混ぜない。不明な画像ホスト/誘導先は判定保留にして返さない。画像のフルサイズリンクが同じ許可フォルダなら原寸を使用する。画像の意味や真贋をAIで判定したとは表示しない。

関連記事は本文中の直リンクと明示的なrelated/recommend/pickup/recent-article-image領域から最大12件。広告/非表示領域内を除き、タイトルと重複URLを統合する。utm_*だけ除去し、他のクエリ・リダイレクト先は拒否。resize.blogsys.jpのサムネイルは埋め込まれた許可CDN URLを取り出し、CDNだけへ接続する。

RSS外の記事を取得する場合、fromの元記事IDに対応するサーバーキャッシュをスキーマ/ID/24時間の有効期限で検証し、related内に対象IDが完全一致した場合だけ取得。クライアントが送った親IDやタイトルだけでは許可しない。親URLを再帰取得せず、キャッシュ失効時は元記事の開き直しを案内する。本文APIのPreview制限を維持する。

この時点では本文キャッシュをv2へ移行（現行v3はADR 005、以後維持）。端末本文はschemaVersion=3を要求し、旧版の未分類画像キャッシュを表示しない。保存記事・既読等のメタデータは削除しない。ReaderSelectionにfromを持ち、最大50件の閲覧経路を保持する。前の経路へ戻ると既存のsessionStorage位置を復元する。関連記事にも非表示サイトとNGワードを適用する。

## Pickup・本文リンク・X画像（ADR 005）

ReaderDocument v3はpageKind（article/roundup）とlinks（最大40件のURL/タイトル）を持つ。タイトル末尾のPickup指定を一覧ページとして認識し、画像ギャラリーを作らず本編へのカードを表示する。daily_popular_title内の直接記事リンクをrandom_text_linkより優先し、同じURLの「続きを読む」は元の見出しを保持する。from/area/type/posとutm_*の装飾だけを除去して既存の固定記事パスで検証する。アンテナ経由のリンクを辿るサーバー処理は追加しない。

本文中の安全なhttp(s)リンクをlinksへ保存し、ReaderTextは対応する文字列だけをReactのa要素として描画する。HTMLは描画しない。URLスキーム・認証情報・ポート・ローカル/IP形式を拒否する。この許可はブラウザの明示的な外部遷移だけに使い、本文APIの取得認可とは分離する。元ページは常時表示の直接リンク、関連記事はアプリ内ボタンと元ページリンクを並置する。

X画像はpbs.twimg.comの/media/画像ファイル、またはformat=jpg/png/webp形式だけを許可し、nameの値・クエリ重複も検証する。外部スクリプト・埋込・プロフィール画像・任意ホストは許可しない。CSPのimg-srcへ同ホストだけを追加する。本文画像が存在する場合は見出し画像をギャラリーから除く。モザイクの除去・推測復元・画像編集は行わない。

サーバーの本文namespaceはv3へ移行し、端末本文スキーマもv3を要求する。保存・既読などのメタデータは維持する。PWAはautoUpdate/skipWaitingで修正を反映し、登録時にも更新を確認する。既に開いている旧版には更新/再起動が必要な場合がある。

## 本文内の画像リンク（ADR 006）

本文のa要素だけでなく、アンカー外のプレーン画像URLも画像ブロックへ追加する。既存の広告/非表示/関連記事の除外を先に適用し、無関係なアンカーのラベルから画像を推測しない。同じ画像はURLで重複排除し80枚まで。

imgur.com/www.imgur.com/i.imgur.comの単一ファイル（5〜12文字の英数字ID＋jpg/jpeg/png/gif/webp、クエリ・認証情報・ポートなし）をhttps://i.imgur.comへ正規化する。IDの大文字小文字を維持する。album/gallery/任意パス/SVG/取得先指定パラメータは拒否。拡張子なしのページURLは本文で同じIDの画像ファイルが確認できた場合だけ対応付ける。ImgurのHTMLや広告・SDKを読み込まず、CSPへ追加するのは画像用i.imgur.comだけ。

readerPicturesは既存の本文画像と検証済みlinksから表示画像を構築する。型の変更はないためschemaVersion=3とRuntime Cache v3を維持し、既に取得した記事と親リンク認可を破棄しない。既存の端末キャッシュ内の画像リンクも自動表示する。

ReaderTextは画像リンクを外部aではなくImageViewerを開くbuttonとして表示。既知の関連記事もonRelatedを通じて開く。通常の外部リンクだけをaとして残し外部記号を付ける。展開画像のインデックスと本文画像の配列を統一し、見出し画像へ誤って戻らない。最初の画像をeager/high、後続はlazyとし、元ページ/保存/既読の操作欄をまとめる。

## MP4・GIFとSNSの直接メディア（ADR 007）

本文のlinksからreaderVideosを派生し、動画用の新しい本文スキーマは作らない。schemaVersion=3とRuntime Cache v3を維持。本文のvideo/sourceはURLだけ抽出し、元のvideo HTML・イベント属性・iframe・scriptは破棄する。最大8本をArticleVideosのネイティブvideoで表示。controls/playsInline/preload=metadataを使い、通常MP4は自動再生しない。アニメーションはmuted/loop、prefers-reduced-motion時は自動再生しない。GIFはブラウザ本来のimg再生を保つ。

許可動画はvideo.twimg.comのamplify_video/ext_tw_video/tweet_videoの固定MP4パス、i.imgur.comの単一MP4（gifvはMP4へ正規化）、配信元livedoor固有フォルダ、Instagramのcdninstagram.com配下の直接MP4。HTTPS・認証情報/ポートなし・既知のパスを検証する。Instagramの画像はjpg/jpeg/png/gif/webp、プロフィール画像パスを除外し署名クエリを維持する。広告等の領域除外はメディア抽出の前に適用。任意URLをサーバーで代理取得しない。

本文の動画リンクはReactのbuttonで該当videoへスクロール・focusし、クリック中にplay()を呼ぶ。再生拒否ならネイティブ再生ボタンを案内。メディアエラーは再読み込みを表示し、外部へ自動移動しない。画像拡大・関連記事移動は従来通り。

X/Instagram投稿の正規URLだけをlinksから判別。メディアURLがない場合は取得不可の案内と外部リンク。公式oEmbedの調査では直接画像URLを得られず、投稿URLだけからの写真展開は実装しない。SDK/iframe・ログイン情報・非公式プロキシは使わない。CSPはimg-srcにInstagram CDN、media-srcに上記CDNを追加し、connect-src/script-srcはself、frame-srcはnoneを維持。メディアバイナリはオフライン保存しない。

外部メディアへRefererを送らない。Vercelの既存Referrer-Policy: no-referrerに加え、HTMLメタで開発/別ホスト/PWAも統一する。Referer付きローカル動画要求の403と、no-referrerで実CDN再生成功を確認した。
