# ROMNOA 正本設計

## 構成

React 19 / TypeScript / Vite / Tailwind CSS 4。Vercel Node.js 24の `GET /api/articles`・`GET /api/reader?article=<記事ID>[&from=<元記事ID>]` とUIを分離する。外部DB・ユーザー登録・AI・広告SDKは導入しない。個人用プレビューをVercel Authenticationで保護する。

`server/sources.ts` → 安全なRSS取得 → XMLパーサー → 正規化・重複排除 → JSON API → React → localStorage。

画面: ホーム（新着/人気・記事・折りたたみカテゴリ/日付）、検索（キーワード・検索対象・マイ検索・累積結果）、カテゴリ（件数と選択）、保存（お気に入り/履歴）、設定（配信元・NGワード・文字・テーマ・PWA案内）。記事タップで本文リーダーを開き、出典・保存・既読・前後移動を提供する。本文はテキスト/画像のブロックと検証したリンクへ変換し、元のHTMLは描画しない。対応動画はリンクから導く。

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
- 入力中のタイトル絞込み・配信元選択はブラウザ処理。確定検索は別の検索APIを使用する。同じAPIパスを共有してキャッシュ分断を防ぐ。
- 広告/未判定画像・iframe・外部scriptなし。画像は許可CDNとサイト固有フォルダを検証し、記事/関連記事を分けて読込。CSPは同一オリジンと検証済み画像・動画CDNに限定。元記事は補助リンクの明示操作で別タブに開く。

## 重複と順序

追跡パラメータ/fragment除去・HTTPS正規化で同一記事を識別。類似タイトルは文字bigramのDice係数0.88以上かつ24時間以内の場合にのみ表示時に折り畳み、展開できる。断定的な同一記事認定や人気スコアには使わない。入力中の絞込みは取得済みタイトル内。確定検索は以下の全期間検索を使用する。カテゴリはRSS分類とタイトルのルールベース推定で正確性を保証しない。

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

## 人気順・日付別探索（ADR 008）

既存の新着APIを変えず、GET /api/discovery?mode=popular|date[&date=YYYY-MM-DD]を分離。dateモードは日付必須、popularの日付併用は現在順位と日付別記事IDの積集合。Articleの永続化スキーマは維持し、順位は別のranks配列（id/rank）で管理する。並び順はサイト別の掲載順位。フィルタ後も元の順位を保ち、人気表示中は類似記事を折りたたまない。

ハムスター速報はサイト自身の人気ウィジェットが使う固定JSON URL（limit=5、rangetype=custom、range=6、画像サイズ指定は元ウィジェットと同じ）。画像データは表示しない。アルファルファモザイクは固定の自社ランキングJSに含まれるcontent.innerHTMLのJSON文字列だけをJSON.parseし、pickup_top3のheading-pickup/pickup_rankを抽出する。JavaScriptは一切実行しない。順位の欠落/重複/他ホストの記事を拒否し、表示順位やPVを推測しない。アルファ側は集計期間非公表。

日付別は固定のhttps://<既知ホスト>/archives/YYYY-MM-DD.html。タイトルの日付、固定見出しと同一記事の公開日時を照合。ハムスター速報はarticle-outer/article-title/updatedのtitle、アルファはarticle/main_article_title/article_timeを使う。タイトル・URL・公開日時だけを返し、一覧の広告/本文HTML/スクリプト/画像は描画しない。最大100記事/配信元、2MB/8秒、DOM深さ120/6万ノード、リダイレクト拒否。ページ送り/上限に当たった場合はlimitedSourcesで一部取得を示す。

DiscoveryServiceは配信元×人気/日付でキャッシュ・同時取得を統合。Runtime Cacheはromnoa-discovery-v1、成功値24時間保持。今日/人気は10分、過去日は24時間、失敗は1分の再試行抑制。障害時の24時間以内の最終正常値はcachedと表示し、全ソース失敗は503。APIはno-store、CDNへ個人用の探索結果を共有キャッシュしない。新着/本文の既存namespaceは維持。

useDiscoveryは条件ごとのキャッシュ（端末内の最大8条件・24時間）とAbortController/条件キーで競合を防ぐ。別の日のデータを代替表示しない。DateFilterは日付確定後に取得し、日本時間・2005年以降〜今日の実在日をサーバーでも検証。日付/人気の表示位置を独立管理する。取得失敗/一部障害/一部取得/前回情報を説明する。

本文APIへ任意URLの認可を追加しない。collection=popular|date:YYYY-MM-DDは検索ヒントにすぎず、対応するサーバーキャッシュが24時間以内で対象ID/配信元が完全一致した場合だけ取得。保存画面では掲載日をヒントに使い、同じ配信元の新鮮な人気キャッシュもcache-onlyで照合する。キャッシュがない/失効した場合は一覧の開き直しを案内し、指定された日付を新規に取得して認可する処理はない。既存の親記事認可・Preview限定・本文schemaVersion=3を維持する。

## 全期間検索と測定値による並べ替え（ADR 009）

GET /api/search?q=<語>&page=1..1000[&sources=hamusoku,alfalfa]を追加。入力はNFKC/空白正規化・80文字以内、制御文字/未知項目/重複キー/不正ページ/未知配信元を拒否。固定ホストの/search/<encodeURIComponent(query)>?p=Nだけへ接続。8秒/2MB・DOM深さ120/6万ノード・100記事/配信元、redirect:error。本文/広告HTMLを返さず、固定見出し/公開日時からArticleを抽出する。実ページで確認したアルファの空?cate装飾だけを除き、他クエリの厳格な拒否は維持する。次ページは同じ配信元/同じ検索語の明示リンクから判定する。

SearchServiceは配信元×正規化語×ページをハッシュ化して10分キャッシュ/最終正常値24時間/失敗1分。Runtime Cacheはromnoa-search-v1。レスポンスcollection=search:<sha256>と記事IDをサーバーに記録し、ReaderServiceのcache-only照合へ接続する。クライアントのハッシュだけでは許可せず、保存/既読/本文v3は維持。端末には本文を開くヒントとして記事ID/collection/日時を最大1000件・24時間保持し、検索語の履歴は自動保存しない。

useSearchは条件キー・AbortControllerで競合を防ぎ、ページを切り替えて表示する。キーワード検索確定で日付を解除し、検索中は日付フィルタを表示しない。新しい語/ページの取得失敗時に以前の結果へ代替しない。マイ検索は公開UIの手動登録語20件、別キーromnoa:my-search:v1へ保存。

検索の人気は、取得ページの記事について、はてな公式count/entries APIの実数をサーバー取得して並べる。40 URL単位（公式上限50以下）、3.5秒/64KB、対象は検証済み2サイトの記事URLだけ。欠けたキーを0で補わず取得不可とする。romnoa-bookmark-counts-v1で10分・失敗1分、ページの記事集合ごとにキャッシュ。数値不可なら新着順と理由を示す。全検索結果/全期間の総合順位とは表示しない。通常ホームの配信元別順位は変更しない。

DateFilterはnative入力を維持しつつ年/月を選べるdialogカレンダー、今日/昨日/週/月/年前と前後日を提供。月末/うるう日は日付を丸める。古い日付の配信元404はunavailableSourcesを返し、ネットワーク障害と区別して全期間キーワード検索を案内する。既存キャッシュは省略フィールドを既定空配列で復元する。

## 検索対象と本文の再照合（ADR 010）

/api/searchはscope=title|body（既定title）を検証し、レスポンスもscopeを返す。配信元検索のメタデータcache/collectionの認可は維持。候補のタイトルをローカルと共通のNFKC/小文字/空白分割ANDで照合する。bodyだけ、タイトルで不足する語を固定本文領域から抽出した文字で補う。全anchor subtree、画像alt、script/iframe/nav/aside、広告・recommend/related/blogrollなど、非表示領域、クラスのない「おすすめ記事」等以降の同コンテナの末尾を除く。別のbody-more rootは引き続き検索する。既存表示用本文キャッシュの混入を引き継がないよう、検索用抽出を独立させる。

共通fetchArticleHtmlは厳格な固定数値記事URL・redirect:error・2MBストリーム制限を維持。本文検索は個人Previewだけ。検索専用サーバーテキストcache romnoa-search-text-v1は正常24時間/失敗1分、プロセス内最大300件・同記事coalescing。1リクエスト6worker、取得処理もプロセス内最大6並列、本文確認全体22秒/個別6秒、DOM深さ120/6万ノード/本文10万文字。リクエスト上限40秒・クライアント45秒。未確認は除外しunverifiedCount、明確な不一致はexcludedCountを返す。本文や抽出語はAPIレスポンス・ログに出さない。メトリクスは絞込み後の記事だけ対象。既存本文v3・保存データを無効化しない。

UIはラジオで検索対象を選択。対象変更はqueryに加えリクエストキーへ含め、ページをリセット。AbortControllerと条件キーで遅延レスポンスの混入を防ぐ。全期間と人気/新着は維持し、0件でも配信元に続きがあればページ送りを維持する。


## 累積検索と確認範囲（ADR 011）

APIは候補全体からcandidateCountとsearchedRange={from,to}を返す。日付は一致結果だけでなく実際に取得できた候補の範囲。クライアントは1回最大5ページ/新規一致20件の逐次バッチで自動確認し、続行操作で次バッチを取得する。配信元のnextSourcesだけを次に渡し、APIの1ページ単位/各取得上限/既存メタデータ・本文cacheは維持する。

appendSearchPageは同語/同scope/単調増加ページのみ結合し、記事URL重複を除き、日付範囲・確認数・除外数・配信元状態を累積する。メトリクス障害を含む場合はnullを維持して新着順へ戻し、0を捏造しない。各記事のcollectionを別mapで保持し、ReaderSelectionは選択IDのcollectionを渡す。ページ追加をスクロール復元キーに含めず、読んでいる一覧位置を先頭へ戻さない。後続取得失敗は最終成功cursorを残す。query/scope/refreshキーとAbortControllerで古いバッチを遮断する。

mergeLocalSearchは保存/履歴のタイトル一致だけを通常/本文モード双方に補完し、リモートとURLで統合、リモートの日付などを優先。端末本文cacheを検索しない。NG/配信元/カテゴリを統合後にも適用。includeUnmeasuredは検索画面だけに限定し、人気順の実測済み記事の後に端末候補を日付順で配置する。実測0と未測定を混同しない。本文の認可は既存ルールを維持し、端末の保存データを新しい許可証にしない。


## 一覧密度とタブ構成（ADR 012）

ホームからwelcome-cardのDOMと検索フォームを除去。上部に今日の記事/新着/人気/更新を置き、HomeFiltersのnative detailsへカテゴリ・DateFilter・詳細SortControlを収納する。取得/順位の説明も開閉でき、取得障害・キャッシュ利用時は自動で開いて状態を説明する。検索タブは既存ArticleSearch/マイ検索/検索結果を受け持ち、サーバーAPIの条件・本文検索の除外基準は変更しない。

homeSort/searchSort/shelfSortを分離し、検索語/入力語は検索タブに保持、保存内の入力とは独立。タブ往復時は検索を保持する。下部/デスクトップ共通で5タブ。全期間検索の継続と記事別collectionは既存useSearch/ReaderSelectionを維持する。

ArticleRowはタイトルを先頭、配信元/日時/既読と順位・ブックマーク実測・端末由来を単一メタデータ行へ配置。大きい配信元モノグラムを小さな色点に置き換え、source名は残す。標準文字15px・1.45行高・最大3行、記事ボタン最小64px/保存44px。全タイトルのaria-labelとReaderの見出しは省略しない。モバイルのsafe-areaを含む上部高と5タブ幅を調整し、Reader本文のレイアウトは変更しない。


## 全取得記事の人気順と本文の密度（ADR 013）

本番DiscoveryServiceはcatalog依存（FeedService、BookmarkMetrics）を注入。通常popularは配信元人気候補とRSS全件を並列取得しURLで重複排除、RSSの日時などを優先する。日付付きpopularはその日付のarchive全件を使い、短い人気ウィジェットとの共通部分に制限しない。候補は最大220（RSS2×100＋配信元順位2×10）。公式はてなAPIを40URL以下ずつ・最大220件で照合し、全IDの実測整数が揃わない場合はnull。rankingBasis=bookmarks、bookmarks、partialSourcesを返し、旧publisher/ranks形式もcache互換として解釈可能にする。クライアントは全候補を維持し、実数順/同数は新着、指標欠損は新着へ戻して理由を示す。

配信元の順位候補はハムスター速報の実在するlimit=10を使用（limit=100指定でも10件という観測）。アルファの公開スクリプトは6件。これらは候補追加に使い、全件の順位根拠ははてな実測数。ハムスター側の公開候補キーをtop10-v2へ変更し、古い5件キーはcache-onlyの認可互換として残す。記事URL・redirect:error・応答サイズ/DOM・RSS/日付cacheを維持する。discovery関数30秒・クライアント35秒とし、配信元/指標ごとの短い期限は維持する。

collection=popular:<sha256(day+sorted article IDs)>のメタデータ集合を、配信元ごと最大110件で既存Runtime Cacheへ保存する。元の取得日時の最小値を持たせ、古い候補の認可期限を延長しない。findKnownは署名/配信元/IDの完全一致と元取得24時間以内だけをcache-onlyで照合。人気集合の端末参照は既存romnoa:search-contexts:v1へsearch/popular両形式として互換追加（最大1000件/24h、検索語なし）。useDiscoveryも参照を記録し、保存記事と検索内の端末候補を開くときに使う。任意ハッシュから新規に集合を取得する処理はない。本文cacheはv3のまま。

Readerは本文テキストのpへreader-text-blockを付け、フォントサイズを変えず行高1.55/下余白6pxにする。compactReaderTextはCRLFを整え、空白だけの行を含む連続改行を単一改行へ整理する表示処理。非空行・字下げ・番号・URLを保持し、元のReaderDocument/cache内容は変更しない。画像/動画/関連記事UIと認可は維持する。


## Yahooニュース公式RSS（ADR014）

既存まとめのArticle/reader許可リストを拡張せず、独立したYahooArticle/YahooResponseを使う。GET /api/yahoo はパラメータを一切受けない。カテゴリdomestic/world/business/entertainment/sports/it/science/life/localの固定RSSだけ取得。URLはnews.yahoo.co.jp/articles/<40 hex>に限定、source=rssだけ除去。画像はRSS item.imageのnewsatcl-pctr.c.yimg.jp/t/amd-img/の画像だけ許可。channel.imageのロゴや記事HTML・広告・おすすめ欄は取得しない。RSS descriptionをReactのテキストとして表示し、HTMLは実行しない。画像は既存ArticleImagesで先頭に配置、CSPに当該画像ホストのみ追加。

YahooServiceはRuntime Cache romnoa-yahoo-rss-v1、成功10分・失敗1分・最後の成功24時間、9カテゴリ/各50/最大450、1MB/6秒/redirect:error、最大3並列、重複要求共有。全カテゴリ失敗時503、部分失敗は他カテゴリを維持。外部アクセスはRSSと開いたニュースの配信画像だけ。ニュース本文URLや任意URLをサーバー取得するAPIはない。

YahooNewsはホーム/検索/保存で共通インスタンスを使い、まとめ検索と独立した検索語/対象を保持。チャンネル変更でスクロールキーも分離。ADR015により検索は公開検索候補へ置換し、配信中最大450件のRSSはホーム一覧の母集団として維持。検索見出し/抜粋のNFKC・小文字AND一致、NG語を適用。本文全文検索とは明確に区別し公式検索の外部リンクを提供。同カテゴリ12件は配信中記事で、Yahooページの推薦取得ではない。

端末romnoa:yahoo-library:v1に保存200/既読1000、romnoa:yahoo-feed:v1に検証済み一覧24時間。サーバーやブラウザで画像データを複製保存しない。sessionStorageに閲覧位置。既存の履歴既読リセットをYahooへも通知、保存は残す。通常の本文v3・保存キャッシュを消さない。廃止したシークレット機能のコード/候補/PIN/APIは配布しない。


## Yahoo掲載記事の検索（ADR015）

Yahoo検索タブで確定した語は/api/yahoo-search?q=&scope=title|summaryへ送る。RSS内だけでは探索しない。新規検索はカテゴリを解除。useYahooSearchは語/対象/再試行キーとAbortControllerを持ち、遅い応答や失敗を別語の結果へ混ぜない。失敗はalert/再試行を表示し、正常0件と区別。検索語を端末へ自動永続化しない。

サーバーは固定公開URL https://news.yahoo.co.jp/search?p=<正規化語> のHTMLを8秒/2MB/redirect:errorで取得、window.__PRELOADED_STATE__の単一JSONからsearchConditions.queryの一致、search.isError=false/startIndex1を検証する。scriptを実行せず内部/apiへアクセスしない。search.contentsのviewType0/serviceIdnews/40hex IDと一致する正規permalinkだけを候補とし、広告・ランキング・おすすめ・関連検索語のstateは使わない。本文ページは取得しない。先頭50候補を上限に、検索見出し/短い抜粋でNFKC AND照合。Yahoo側totalResultsは検索対象を広げた候補総数で、タイトル一致総数とは表現しない。

YahooArticleへoptional origin=search/displayDate/providerを追加し既存RSS保存との互換を維持。検索用日時は年がないためpublishedAt=null、元の表示文字をdisplayDateへ。検索結果の掲載順を維持し、年月を捏造してソートしない。検索由来はサムネイル最大192px/検索抜粋として表示、RSSの原画像・記事本文とは区別。既存allowlistの画像ホストのみ、記事URLを新たな本文取得権限にはしない。

YahooSearchServiceはqのSHA256をキーに、Runtime Cache romnoa-yahoo-search-v1（10分成功/1分失敗/24時間最終成功）、local128件・同一要求共有。scopeは同じ候補を再利用。Previewのみ、GET/80文字/既知scope/重複・未知パラメータ拒否。失敗を空の正常応答で返さない。本文v3と既存RSScacheは変更しない。


## 記事原画像とMANTAN写真特集（ADR016）

YahooReaderは/api/yahoo-photos?article=<canonical Yahoo URL>で写真メタデータを取得し、articleDetail.contentId/newsLinkの一致、richObjectItems.view.uriを検証して表示する。検索192pxクロップを推測で拡大しない。paragraphs.textDetails.linkの特集を先頭に、relatedLinkの対応フォトページを続ける。本文文章は保存/応答に含めず、ランキング/広告stateは対象外。

主な写真特集をYahooPhotoFeatureとして記事画像の直下に自動表示。別ダイアログ/外部ブラウザは必須でない。特集の親URLをfeature、写真一覧内のURLをpageとして同じAPIへ渡す。サーバーは親記事にfeatureが存在し、最初の特集ページで取得した写真一覧にpageが存在することを確認する。MANTANの現在写真.photo__photo--minh内の.photo__imageを読み、srcsetの実在する最大画像URLを選択。同特集IDのphoto__photolist-itemと画像だけをサムネイル一覧へ。広告/関連/非表示要素を除外し、連番画像やURLを推測生成しない。

固定URL検証: Yahooの40hex記事URL、MANTAN2ホストのarticle/<date-dog-id>/photopage/<3digits>.html、storage.mantan-web.jpの同特集ID画像のみ。tracking ext_m=yだけ除去。任意URL/host/credentials/port/redirectを拒否、HTML2MB/8秒/深さ160/要素60000、写真一覧80/特集12/記事画像40。Previewのみ、Function30秒/ブラウザ25秒。CSPはstorage.mantan-web.jpをimg-srcへ追加、script/frame/connectは広げない。

YahooPhotoServiceは専用Runtime Cache romnoa-yahoo-photos-v1、正常1時間/失敗1分/最後の成功24時間、メモリ120件・同一URLの要求共有。写真ページの取得は選択したものだけ。ブラウザは写真URLメタデータをメモリ100件/1時間保持。MANTAN画像は/api/yahoo-photo-imageの閉じた配信を使用し、独自DB/Blobへ保存しない。既存reader v3キャッシュを変更しない。

写真特集は左右スワイプ/前後/サムネイル/拡大に対応し、原画像とキャプション・出典を維持。「記事の写真／写真特集／ニュースへ」をReaderのスクロール領域の外へ配置、長い写真一覧でもニュースへ直接移動できる。画像取得失敗は再試行と元写真ページへの明示リンクを表示し、失敗した写真の代わりに前の写真を現在画像として表示しない。


MANTAN画像配信は、ブラウザからCDNへ参照元なしで取得すると403の404画面を返すが、画像が明示された写真ページの文脈を保つ通常の画像取得では200になることを実通信で確認した。/api/yahoo-photo-image?article=&feature=&page=&size=full|thumbは、YahooPhotoServiceで記事/特集/写真一覧への所属を毎回確認し、サーバーが取得済みの正確な画像URLと参照ページだけを解決。クライアントは任意URL/Refererを入力できない。出典ページをRefererとして使い、実在するsrc/srcsetの画像を取得する。ログイン/認証情報/ユーザーのCookieやUA偽装は使わない。

画像は8秒/2MB/redirect:error、JPEG/PNG/WebP/GIFだけ許可し、HTML/SVGを返さない。Preview限定、nosniff/CORP same-origin、private max-age3600、Vercel CDN no-store。プロセス内の画像キャッシュ32枚/16MB/1時間・同一要求共有、永続画像ストレージは追加しない。Yahoo見出し写真の既存no-referrerは維持する。
