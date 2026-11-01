# 写真リンク全件調査（2026-11-01）

Vercel Sandbox（東京 hnd1）で `scripts/survey-yahoo-links.ts` を実行。Yahoo!ニュース9カテゴリRSSの全450記事を実取得し、本文・段落・関連リンク約3,700件を分類。写真候補（記事×URL）を本番と同じ `YahooPhotoService` で解決した。RSSの内容は実行ごとに入れ替わるため、各回の対象記事は同一ではない。

| 実行 | 写真候補 | 複数枚 | 1枚 | 失敗 |
|---|---:|---:|---:|---:|
| 修正前（調査1） | 約230 | — | — | 失敗形式の主因を特定 |
| 修正途中（調査2） | 225 | 115 | 65 | 45 |
| 修正後（調査3） | 227 | 124 | 78 | 25 |
| 追加修正後（調査4） | 219 | 148 | 54 | 17 |

失敗の内訳（調査3）: 取得不可15（配信元403、リンク切れ、外部リダイレクトなど）、不完全9（宣言枚数に満たない）、写真以外1。
失敗の内訳（調査4）: 取得不可12、不完全5。

## 主な修正と実ページでの確認

| 形式 | 修正前 | 修正後 |
|---|---|---|
| Natalie `gallery/news/N/media/N`（写真/動画フォルダ違い） | 1枚（動画サムネイルのみ） | 5枚 |
| qjweb `article-gallery/N`（253枚の一覧） | 1枚 | 現在位置の前後80枚＋「取得済み」 |
| qjweb feature | 1枚 | 6枚 |
| Game*Spark `article/img/…/N.html` | 不完全 | 48枚 |
| CinemaToday `gallery/E…` → `002.jpg.html` | 1枚 | 40枚まで＋「取得済み」 |
| TBS NEWS DIG `articles/gallery/N` | 20件中19件失敗 | 20件中4件失敗（6枚等） |
| motor-fan `?attachment_id=` | リダイレクトで失敗 | 取得 |
| Real Sound「画像 1 / 1」 | 構造変更エラー | 1枚（完全） |
| Auto Messe Web `image/N` | 失敗 | 25枚 |
| PRESIDENT `articles/photo/N?pn=N`（splideスライダー） | 1枚 | 4〜5枚、`pn`の位置を選択 |
| 乗りものニュース `photo/N`（swiper、末尾に関連記事カード） | 1枚 | 4〜6枚 |
| ベストカー `images/N`（Smart Slider 3） | 取得失敗 | 3〜12枚 |
| LIMO `articles/photo/N`（1枚表示＋記事本文、本文は複数ページ） | 1枚 | 宣言枚数どおり（2〜5枚）。「1/1」のページは1枚 |

## 未対応・対応しないもの

- 配信元が403を返す: WWD JAPAN、webike、CanCam（ブラウザを装う回避はしない）
- リンク切れ: Forbes JAPAN（404へ転送）、eiga.com（404）
- 外部オリジンへの転送: abema.go.link
- NEWS DIG の一部（宣言枚数と写真JSONの不一致）
- 記事2ページ目等へのリンクで実際に写真が1枚のもの（ENCOUNT、東スポ、full-count など）は正しい結果

調査・確認用ツール: `scripts/survey-yahoo-links.ts`（全件）、`scripts/check-photo-pages.ts`（URL指定・各写真ページの照合）、`scripts/trace-sibling.ts`（兄弟ページ判定の理由）。
