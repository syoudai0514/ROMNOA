# ROMNOA — Read freely.

ロムノア。「読みたい話題だけ、ノイズなく。」iPhoneを優先した、まとめ記事の発見・保存用PWAです。

**新着・保存機能の試作版です。広告なしの全文閲覧は未対応で、最重要の閲覧体験は未完成です。iPhone実機確認も未実施です。** ロムノアの画面には広告を置きません。現在の配信元の全文転載許諾は確認できていないため、本文は元サイトで開きます。外部サイトには広告が表示される場合があります。

## 起動

Node.js 24 と npm が必要です。

```sh
npm ci
npm run dev
```

Viteの開発サーバーがUIと `/api/articles` の両方を提供します。本番はVercelのNode.js Functionを使用します。環境変数やDBの設定は不要です。プロキシ環境のNode.jsでは、その環境の指定に従い `NODE_USE_ENV_PROXY=1` を利用してください。

## 実装内容

- ハムスター速報・アルファルファモザイクの実在するRSSをサーバーで統合
- 新着/未読優先/カテゴリ順、キーワード検索、カテゴリ選択
- 保存/既読/閲覧履歴、NGワード、配信元の表示切替、類似タイトルの折りたたみ
- ライト/ダーク/端末設定、文字サイズ、記事詳細と元記事導線、前後移動、アプリ内スクロール復元
- ロゴ/アイコン/PWA、オフライン用アプリシェルと記事メタデータキャッシュ
- 固定フィード許可リスト、取得制限、XML/XSS対策、障害分離とキャッシュ

保存・設定は端末のブラウザ内だけに保持します。保存記事はメタデータであり本文や画像ではありません。現在のフィード範囲外を横断検索する機能、人気順位、全文リーダー、AI推薦、アカウント、端末間同期はありません。

## テスト

```sh
npm run build
npm run check:server
npm test
npx playwright install --with-deps chromium webkit
npm run test:e2e
npm run check:feeds
```

Chromiumのシステムパスを使う場合は `PW_SYSTEM_CHROMIUM=1`。E2Eはテスト専用データを使用し、外部フィードの障害に依存しません。実RSSは `check:feeds` で別途確認します。PWAの本番ビルド検証は `npm run test:pwa`（ビルド後）で実行します。WebKitのiPhoneエミュレーションは実機Safariの代わりにはなりません。

## デプロイ

VercelでこのGitHubリポジトリをImportし、Vite・Node.js 24を選択します。`vercel.json` にFunction・CSP・出力先を設定済みです。個人利用ではPreviewのアクセス保護を維持してください。一般公開前に、配信元の集約表示条件とiPhone実機チェックを確認します。

## 資料

- [正本要件・ID](docs/requirements.md)
- [正本設計](docs/design.md)
- [競合・配信元・利用条件の調査](docs/research.md)
- [設計判断](docs/decisions/)
- [運用・障害対応・実機チェック](docs/operations.md)
- [検証結果](docs/verification.md)

商標登録状況・ドメインの取得可能性・第三者コンテンツの全文再配信許諾は未確認です。
