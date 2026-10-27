# ROMNOA — Read freely.

ロムノア。「読みたい話題だけ、ノイズなく。」iPhoneを優先した、まとめ記事の発見・保存用PWAです。

**認証付きの個人用プレビューです。** 記事をタップするとアプリ内リーダーで本文を表示し、広告・動画・ポップアップ・外部スクリプトを描画しません。画像は表示ボタンを押したときだけ読み込みます。一般公開の全文再配信許諾とiPhone実機確認は未完了のため、Phase 1全体の完成とはしていません。

## 起動

Node.js 24 と npm が必要です。

```sh
npm ci
npm run dev
```

Viteの開発サーバーがUIと `/api/articles`・`/api/reader` を提供します。VercelではNode.js Functionを使用します。外部DBやアプリAPIキーの設定は不要です。プロキシ環境のNode.jsでは、その環境の指定に従い `NODE_USE_ENV_PROXY=1` を利用してください。

## 実装内容

- ハムスター速報・アルファルファモザイクの実在するRSSをサーバーで統合
- 新着/未読優先/カテゴリ順、キーワード検索、カテゴリ選択
- 保存/既読/閲覧履歴、NGワード、配信元の表示切替、類似タイトルの折りたたみ
- ライト/ダーク/端末設定、文字サイズ、記事詳細と元記事導線、前後移動、アプリ内スクロール復元
- ロゴ/アイコン/PWA、オフライン用アプリシェルと記事メタデータキャッシュ
- 固定フィード許可リスト、取得制限、XML/XSS対策、障害分離とキャッシュ
- アプリ内本文リーダー（個人用Preview限定）、検証済み記事画像の明示読み込み、本文のIndexedDBキャッシュとオフライン閲覧

保存・設定は端末のブラウザ内だけに保持します。お気に入り・既読は既存のメタデータ保存を維持し、読んだ本文を別のIndexedDBに最大100件・24時間キャッシュします。画像自体はオフライン保存しません。現在のフィード範囲外を横断検索する機能、人気順位、AI推薦、アカウント、端末間同期はありません。

本文APIは現在のフィードにある記事または24時間以内の本文キャッシュが対象です。配信期間外・アクセス拒否・ページ構造の変更時は本文を取得できない場合があります。元記事は補助リンクから任意に開けますが、その場合は広告が残ります。

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

VercelでVite・Node.js 24のPreviewに配置します。`vercel.json` にFunction・CSP・出力先を設定済みです。**PreviewのVercel Authenticationを維持してください。本文APIはProductionでは403になります。** 一般公開前に、配信元の本文利用条件・許諾とiPhone実機チェックを確認します。設計判断は [ADR 003](docs/decisions/003-personal-reader.md) を参照してください。

## 資料

- [正本要件・ID](docs/requirements.md)
- [正本設計](docs/design.md)
- [競合・配信元・利用条件の調査](docs/research.md)
- [設計判断](docs/decisions/)
- [運用・障害対応・実機チェック](docs/operations.md)
- [検証結果](docs/verification.md)

商標登録状況・ドメインの取得可能性・第三者コンテンツの全文再配信許諾は未確認です。
