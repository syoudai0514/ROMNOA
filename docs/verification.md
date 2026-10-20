# 検証記録

実施日: 2026-10-20。**Phase 1の総合判定: 未完了（iPhone Safari実機未確認）**。

## 環境・開始時点

- GitHub: `syoudai0514/ROMNOA`、開始ブランチ `main`
- 開始HEAD: `d851d7922263e1026d3abeac1a59b0f3222f1787`
- 既存ファイルはREADMEだけ。既存ソース/テスト/CI/AGENTS.mdなし。
- 実装ブランチ: `feat/romnoa-mvp`。最終SHAはGitHubのPR/コミット履歴と作業報告で特定する。
- Linux / Node.js 24.19.0 / npm 11.9.0

## 結果

| 検証 | 結果 | 証拠・範囲 |
|---|---|---|
| TypeScript + Vite本番ビルド | 成功 | `npm run build`、manifest/SW/PNGアイコン生成 |
| Native Node.js ESM | ビルド時に検証 | `check:server`: NodeNextでAPIのモジュール群をコンパイルし、実際のNode.jsでimportしてクエリ拒否を確認。Vite/Vitest固有の解決に依存しない |
| Vitest | 23件成功 | security 15、feed-service 4、personalization 4 |
| Playwright Chromium | 14件成功 | iPhone 13相当7件 + desktop 1440px 7件 |
| Playwright WebKit | 7シナリオ成功 | iPhone 13相当。6件成功後、長い操作シナリオ1件の30秒制限を60秒に調整し当該1件成功。アサーションの緩和なし |
| 本番PWA | 成功 | `test:pwa`: 本番ビルドのmanifest/icons/本物のSW/オフライン再読み込み/保存記事表示、pageerror 0 |
| 実RSS | 2配信元成功 | `check:feeds`: hamusoku 20件（最新2026-10-20T03:17:00Z）、alfalfa 50件（最新2026-10-20T03:00:53Z） |
| UI→API→実RSS→表示 | ローカルで成功 | 開発サーバーへブラウザアクセスし70記事、ページ例外0、1440pxで横はみ出しなし |
| 外部読込なし | 成功 | E2Eで外部ホスト要求0、iframe/video/外部scriptなし |
| 375px/390px幅・文字大・暗色 | 成功 | E2Eで横はみ出しなし。視覚確認でモバイル説明カードを縮小 |
| 依存パッケージの本番監査 | 指摘0 | `npm audit --omit=dev`（実施時点）。将来の脆弱性不存在は保証しない |
| iPhone Safari実機 | **未実施** | Linux WebKitやChromiumのエミュレーションは実機の代替ではない |
| 一般公開時の集約許諾 | **未確認** | 個人試用のメタデータ専用。全文転載許諾も未確認で全文機能無効 |

WebKitの実行環境ではroot権限がなくOS依存ライブラリが不足していたため、Debianパッケージを作業用ディレクトリに展開してブラウザのローカルライブラリディレクトリへ補った。ldconfigの検出に反映されないため実行時は `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` を使用。ブラウザ自体とすべての操作・アサーションは実行した。通常環境/CIは `playwright install --with-deps` を使用する。

## 操作シナリオ

1. 新着から記事詳細→外部リンク・広告注意文→保存→次記事→閉じる→再起動→保存/既読/履歴の保持
2. 検索→カテゴリ→未読優先→配信元非表示→NGワード追加→再起動後の保持
3. カテゴリ画面→暗色/文字大→再起動→375pxで横はみ出しなし
4. 全件取得失敗→端末キャッシュ/保存から継続
5. 配信元一部障害の説明→一覧継続、外部ホスト自動要求なし
6. 記事詳細のフォーカス/閉じる/一覧スクロール/詳細位置復元
7. 破損保存データと書込拒否の警告、操作の継続

## 受け入れ条件の現状

- [x] 実在する複数配信元から記事取得（ローカル実通信）
- [x] iPhone相当幅で正常表示（エミュレーション）
- [x] ロムノア自身に広告なし
- [x] 記事詳細から適切な元記事へ移動する導線
- [x] 未許諾の全文をアプリ内で転載しない
- [x] 取得障害時もアプリを継続利用
- [x] 保存・既読の再起動後保持
- [x] PWAに必要なmanifest/SW/iconとオフライン動作
- [x] 主要操作のPlaywrightテスト
- [x] ビルド・ローカル自動テスト成功
- [x] 要件ID・設計・実装・検証を対応付け
- [ ] iPhone Safari実機シナリオと実機でのホーム画面追加

## 実装しない将来機能・残る制約

許諾済み全文リーダー、AI推薦、アカウント、同期、根拠ある人気順は未実装。全文の広告除去は保証しない。元サイト本文のスクロール位置は管理できない。検索は取得済み記事のみ。カテゴリ・類似記事はルールによる推定。保存最大200件/履歴・既読500件。キャッシュは24時間以内。

## デプロイとCIの確認方法

Vercelの `romnoa` プロジェクト（Node24、hnd1、Preview認証保護）を作成。GitHub連携はVercel側で未設定のため自動接続は失敗し、同一コミットのソースを直接アップロードする方法を選択。デプロイURL・状態・実際のSHAとGitHub CIの実行結果は最終作業報告に記載する。ローカル成功とクラウド上での成功を混同しない。

最初のクラウド検証で画面200/API500を検出。Runtime Logsの `ERR_MODULE_NOT_FOUND: /var/task/server/handler` を根拠に、サーバー実行経路のimportを`.js`指定へ修正し、ビルド時にNative Node ESMのチェックを追加した。

続くクラウド検証ではsanitize-htmlのCommonJSからESM専用htmlparser2へのrequireがランタイムで拒否された。初期版ではHTMLを描画せずタイトル文字列のみ扱う設計に合わせ、htmlparser2をESMで直接importしてテキスト抽出する構成に変更。Native Nodeチェックも `--no-experimental-require-module` で実行し同じ制約を検証する。
