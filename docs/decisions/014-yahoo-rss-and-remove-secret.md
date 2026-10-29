# ADR 014: シークレット機能廃止とYahoo公式RSS

日付: 2026-10-29。採用。ADR009の隠し操作/候補部分を廃止する。

利用者はシークレット機能とソース削除、Yahooニュースの画像先頭・本文・検索・広告なし・関連記事移動を希望した。PINダイジェスト、UI/gesture/API/catalog/maintenance scriptを削除し、通常マイ検索を維持する。Git履歴や既存読書データは改変しない。

公式RSS9カテゴリの実通信で画像と記事冒頭の存在を確認。ただし全文はRSSに存在せず、公式ヘルプは二次利用に提供元の了承を要求する。原要件の無断全文取得禁止を維持し、全文をスクレイピングする実装を入れない。RSSの範囲で画像・冒頭表示、検索、同カテゴリ移動、保存・既読を実装。依頼された全文展開/元ページ関連記事/全期間本文検索は未達として正本要件に保持。

既存まとめArticle/本文認可を緩めず、専用Yahooモデル/API/UI/cacheを分離する。任意URL入力は拒否、固定RSSだけ取得。外部画像はRSS item.imageの固定Yahoo CDNだけ。検索は当該RSS集合のタイトル/概要のAND一致で、フルアーカイブ検索と誤認させない。移動候補は「同じカテゴリのニュース」と表示。

根拠: [公式RSS一覧](https://news.yahoo.co.jp/rss)、[RSSヘルプ](https://support.yahoo-net.jp/PccNews/s/article/H000011243)、[二次利用の公式条件](https://support.yahoo-net.jp/PccNews/s/article/H000006460)。
