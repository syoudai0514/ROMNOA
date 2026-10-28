# 競合・配信元調査

調査日: 2026-10-20 UTC。公開WebのHTTP応答と公式掲載情報による。アプリを購入・実機検証した結果ではない。全文転載や一般公開の許諾取得とは区別する。

## 競合

| 対象 | 確認元 | 観察 | ROMNOAへの反映 |
|---|---|---|---|
| MT2（まとめサイトビューア） | [App Store](https://apps.apple.com/jp/app/id406613151) / Apple Search API | 公式説明に新着/人気/ブログ別/横断検索/履歴/ブックマーク/文字サイズ等。掲載されている機能であり実測ではない | 新着から発見→保存→再訪の導線を重視。信頼できる人気データがないので人気順は提供しない |
| Marimba2log | [App Store](https://apps.apple.com/jp/app/id497214545) / Apple Search API | 公式説明にカテゴリ/人気/ローカル保存/ナイトモード/広告削除等 | 暗色・保存を初期対応。広告削除技術や転載権利を他社から推測しない |
| 2ちゃんねるまとめのまとめ | [公式](https://2chmm.com/) / [about](https://2chmm.com/about.html) | 複数サイトのタイトル・時刻・出典と外部リンクによる高密度な一覧を確認。HTTP 200 | 情報密度を保ち、端末内の既読・NG・配信元制御で巡回を軽くする |
| まとめサイト速報＋ | [公式](https://matome-plus.com/) | HTMLページ HTTP 200。タイトルと外部サイト導線を確認 | 外部遷移の性質を明示する |

Apple Search API: `https://itunes.apple.com/search?term=2ch&country=jp&entity=software&limit=8` を取得。評価・順位・利用者数は比較していない。

## 配信元台帳

| ID | サイト / 実在フィード | 確認内容 | 本文・画像の扱い |
|---|---|---|---|
| hamusoku | [ハムスター速報](https://hamusoku.com/) / [RSS](https://hamusoku.com/index.rdf) | トップにRSSリンク（http表記、HTTPSで取得成功）。RSS 1.0 RDF、20件の有効記事、HTTP 200。タイトル・リンク・dc:dateを確認 | 一覧はメタデータ。2026-10-27に個人用Previewの本文リーダーを追加。一般公開の全文転載許諾は未確認 |
| alfalfa | [アルファルファモザイク](https://alfalfalfa.com/) / [RSS](https://alfalfalfa.com/index.rdf) | トップにFeedly購読リンクで同フィードが指定。RSS 1.0 RDF、50件の有効記事、HTTP 200 | 一覧はメタデータ。2026-10-27に個人用Previewの本文リーダーを追加。一般公開の全文転載許諾は未確認 |
| 不採用 | キニ速 `https://blog.livedoor.jp/kinisoku/index.rdf` | トップ・RSSとも今回503応答 | 制限回避・別ルート探索は行わず初期対象外 |

両採用サイトの `/robots.txt` は今回404。これは転載許可でも収集の包括的許可でもない。サイトのRSS購読導線を根拠に、個人向けRSSリーダーとしてタイトル等のメタデータに限定した試用を設計した。将来の一般公開における集約表示の権利範囲は別途確認する必要がある。

## 利用条件の確認

- [ライブドア利用規約](https://blog.livedoor.com/rule/) HTTP 200。1.3.2は提供データの利用をサービスの目的・許諾範囲に限定し、1.4.1は知的財産権侵害等を禁止する。第三者への独自の全文再配信許諾は確認できない。
- ハムスター速報のトップには画像等の著作権・肖像権問題の連絡先記載があるが、第三者への転載許諾とは解釈しない。
- アルファルファモザイクのトップにはRSSのFeedly購読導線があるが、全文転載許可の記載は確認できなかった。
- フィードの「全文が入っている」「HTTP 200」「robots.txtがない」を根拠に全文転載を有効化しない。
- `sourceInfo`（UI出典）と `server/sources.ts`（取得先）を固定し、追加時はこの台帳・許諾記録・セキュリティテストも更新する。

## 残る確認

一般公開用の集約・本文表示の許諾、商標・ドメイン取得可能性、iPhone Safari実機動作は未確認。一般公開リーダーは許諾確認後に別途判断する。権利者からの停止要請時は配信元を外しキャッシュを消去する（operations.md）。

## 2026-10-27: 外部広告の残存に対する再確認

利用者から、元サイトへ移動すると広告が多いとの報告。現行版はメタデータ集約であり「広告なしで本文を読める」という最重要の体験を満たせていない。PWA化や説明表示の修正で外部広告が消えることはない。

- ハムスター速報のトップ、アルファルファモザイクのトップ・[About](https://alfalfalfa.com/articles/234245.html)、公開Web検索を再確認。今回の調査範囲では、アプリ内全文再配信を明示的に許諾する配信元を新たに確定できなかった。許諾が存在しないと断定するものではない。
- [Apple公式ガイド](https://support.apple.com/ja-jp/guide/iphone/iphdc30e3b86/ios)で、Safariの自動リーダー設定を確認。「設定」→「アプリ」→「Safari」→「リーダー」→「すべてのウェブサイト」。リーダー対応ページが対象で、現行2配信元での実機適用可否や全広告の非表示は未検証。
- 画面上の「広告のないアプリ」という表示を外部本文であることが分かる表現へ改め、記事詳細のSafari案内を折りたたまず表示する。これは説明と補助導線の改善であり、全文閲覧機能の実装や外部広告問題の解決として数えない。
- 全文リーダーは引き続き未実装。元の要件を縮小せず、本文の利用条件・許諾を確定してから対応する。無断転載や制限回避は行わない。

その後の利用者の明示的な修正指示を受け、個人用PreviewについてはADR 003へ更新した。公開ページ200応答の本文要素を特定し、現在のRSSで発見した記事の読書表示を実装。これは一般公開の全文再配信許諾を新たに取得したという調査結果ではない。ハムスター速報のRSS content:encodedは記事画像中心、アルファルファRSSはscript/関連記事も含むため、RSSの量から記事全文の完全性を判定せず、ページの固定本文要素を利用する。

## 2026-10-28: MP4とSNSの公式経路の確認

- 報告記事: https://alfalfalfa.com/articles/11019201.html 。本文にvideo.twimg.comのamplify_video MP4とX投稿へのリンクがある。2026-10-28の通常HTTPS GETとRange GETで当該MP4は404、応答0バイト。アプリの表示改善だけではこのファイル自体を再生可能にできない。
- X公式oEmbed: https://publish.twitter.com/oembed （公式資料: https://developer.x.com/en/docs/x-for-websites/oembed-api ）。報告記事の公開投稿URLにomit_script=true/dnt=trueで200を確認。応答にthumbnail_urlなし、html内imgタグ0。直接画像URLを得られなかった。第三者プロキシ・非公式guest APIは利用しない。
- Instagram公式oEmbed: https://graph.facebook.com/instagram_oembed （公式資料: https://developers.facebook.com/docs/instagram/oembed/ ）。配信元の公開記事11101860.htmlに含まれる実在投稿URLで200を確認。返却キーはversion/provider_name/provider_url/type/width/html、thumbnail_urlなし。html内imgタグ・cdninstagram URLは0。公式応答は埋込用マークアップであり、この確認では直接写真URLを得られなかった。トークン必須という未検証の説明はしない。
- 記事に含まれるXの画像/MP4、Instagram CDNの直接URLは表示対象にする。投稿URLだけから写真や全添付メディアを展開する機能は未実装。公式ウィジェットの自動実行は採用しない。実際のInstagram CDNの写真読込は別途確認が必要で、合成fixtureの成功を実通信成功と扱わない。

## 2026-10-28: 人気順と日付別の根拠

- ハムスター速報のホームにpopular_rankingウィジェットを確認。公式livedoor部品 https://parts.blog.livedoor.jp/plugin/popular_articles_with_image_plugin.js?v=20130911 はrangetype=custom/range=6/count=5の設定から同サイトのarchives/popular_articles.jsonを使用する。実際の https://hamusoku.com/archives/popular_articles.json?limit=5&with_image=1&image_width=320&image_height=290&rangetype=custom&range=6 が200で5記事、url/title/created_at_ymdhm/count等を返すことを確認。順位配列だけを使用し、PVは表示しない。スクリプトは調査用に文字列として読み、実行しない。
- アルファルファモザイクのホームから自社ウィジェット https://alfalfalfa.com/js/blogparts/pc_pop_ranking.async.js への参照を確認。200。JSON文字列内の人気記事TOP6/明示的pickup_rankが1〜6、同サイトの記事URLが6件。コメントにはPVのTOP6とあるが集計期間・各PV値は非公表のため「掲載中TOP6」と表示する。
- 実在する日付別ページ https://hamusoku.com/archives/2026-10-20.html と https://alfalfalfa.com/archives/2026-10-20.html は双方200、ページタイトルは2026年10月20日。記事の見出しと公開日時を照合して9件/50件、計59件を取得。今回の確認ページではページ送りなし。RSSの掲載範囲にない記事も含む。架空のRSSや検索APIを追加したわけではない。
- 上記は公開ページ/公開ウィジェットのメタデータ利用の技術的確認であり、一般公開サービスへの集約許諾を確認済みとは扱わない。既存の個人用認証Previewで検証する。

- 集計期間の単位は[livedoor公式ヘルプ](https://support.livedoor.info/hc/ja/articles/9656884021903)で照合。range=6は「6=一週間分」（今日と前6日を含む）と明記される。ハムスター速報は直近1週間の順位と表示する。数値6から時間や日数を推測しない。

## 2026-10-28: 全期間検索・実測人気・候補語

- アルファの公開フォームはGET https://alfalfalfa.com/search のq入力。両サイトで/search?q=図書館が200、ページ内に/search/<encoded語>?p=2の直接リンクが存在。両方の実ページ2も200。ハム1ページ目20件/2ページ目20件、アルファ1ページ目45件/2ページ目44件。アルファの直接記事リンクには空?cate装飾があり、除去すると検証済み数値記事URLになる。
- 実APIで「図書館」の1ページ目65記事、2ページ目には2022年の記事、ハム5ページ目20記事（2021〜2020年）を確認。日付条件は渡していない。配信元のインデックス・表示上限に従い、全記事の網羅は保証しない。
- 2010-10-20/2015-10-20の日付別ページは両配信元とも404。2015-10の月別ページも双方404。古い一覧が存在すると仮定せず、未提供の説明とキーワード検索を案内する。
- [はてな公式件数取得API](https://developer.hatena.ne.jp/ja/documents/bookmark/apis/getcount/)は/count/entriesで50 URL以下の件数取得を公開。実際のHTTPS APIが200で2記事の0/1件を返した。実検索65記事にも65個の実数が返ることを確認。アプリは40 URLずつ取得し、広告/ブラウザSDKは追加しない。
- 隠し候補は18の語/組合せを実検索。明白な未成年・露骨な見出しを除いた取得範囲で、美脚48、モデル 美脚10、細い 脚18、スレンダー52、ルーズソックス32、女優 ブーツ3、大人 ミニスカート3、女優 写真集34、女優 ドレス49、グラビア インタビュー49、モデル 写真集19を確認（2026-10-28 UTC 05:58〜05:59）。この11語だけ採用。0〜2件の組合せは採用しない。数値は取得したページの観測値で総ヒット件数ではない。画像の年齢や内容をAI判定したという意味ではない。


## 2026-10-28: 人気候補の上限を再確認

ハムスター速報の既知popular_articles.jsonへlimit=100を指定しても返却articlesは10件だった。実在するlimit=10の結果を候補取得に採用。アルファルファモザイクの既知pc_pop_ranking.async.jsはpickup_rank6件。サイト独自の全記事閲覧数を得られたとは扱わない。新着全件とこれらの候補の実はてなブックマーク数を照合し、取得済み全件を対象に並べる。ローカル実データの最初の確認では82記事すべてに実数が返り、両配信元okだった（件数は変動する）。
