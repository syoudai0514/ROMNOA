# 運用・障害対応

## 起動と検証

Node.js 24 / npm。`npm ci` → `npm run dev`。本番相当ビルドは `npm run build`。通常のVite previewは静的ファイルの確認用でありAPIの運用サーバーではない。

`npm test` はXML/SSRF/XSS/重複/キャッシュ/パーソナライズを検証。`npx playwright install --with-deps chromium webkit` 後に `npm run test:e2e`。`npm run check:feeds` は外部RSSへ各1回アクセスするためCIで毎回実行しない。

## Vercelへの配置

GitHubのROMNOAをVercelでImportしViteを選ぶ。Node.js 24、build `npm run build`、output `dist`。`vercel.json`にhnd1と15秒の上限、CSPを設定済み。DBやアプリAPIキーは不要。個人利用中はPreview Deployment Protectionを維持する。一般公開前に配信元表示条件・実機確認を完了する。

APIパスは `/api/articles` のみ。クエリ不可。UI/機密設定をCDNに混在させない。検索・NG・保存はサーバーへ送らない。Vercel Runtime Cacheはサーバーの自動設定を使用。キャッシュが使えない場合はログが出るので本番で確認する。

## キャッシュと負荷

- 配信元ごとの成功/失敗を10分間再取得しない。最終正常データは24時間以内に限って利用。
- Vercel Runtime Cacheは永続DBではなく、eviction/cold miss/同時インスタンスによる重複取得は起こり得る。配信元増加や利用量増加時は取得回数を監視し、必要なら単一の収集ジョブと永続ストアへ移行する。
- CDN: max-age=600 / stale-while-revalidate=86400。全件失敗時503/no-store。
- ブラウザ: 検証済み記事データを24時間保持。設定/保存とは独立。サーバーが全件失敗しても保存一覧は開ける。
- 更新ボタンはキャッシュを強制破棄しない。取得間隔を画面に明記。

## 監視

Vercel DashboardでFunction errors、実行時間、Invocation数、転送量、Runtime Cache利用量、ビルド結果を確認。無料枠を超えない保証はない。UIの配信元状態とAPI JSONのstatus/fetchedAtを確認する。ログはsourceIdと固定エラー分類のみで、記事本文やユーザーの検索・NGワードを記録しない。

## 障害対応

| 症状 | 確認・対処 |
|---|---|
| 1サイトのみ失敗 | sources.statusを確認。10分後に再試行。配信元のHTTP状態とRSS形式を確認し、制限回避はしない。他サイトを継続表示 |
| すべて取得失敗 | API503/ログ/配信元状態を確認。ブラウザキャッシュと保存記事を利用。配信元のURLをユーザー入力で差し替えない |
| cache_read/write_failed | Vercel Runtime Cacheの状態・クォータ・環境を確認。空キャッシュでもAPIは動くがアクセス増を監視 |
| XML形式変更 | research台帳と取得仕様を再確認し、パーサーの回帰テストを追加して修正 |
| 保存できない | 容量・プライベートモード・サイトデータ制限を確認。設定画面の削除機能は履歴/既読だけを対象とする。保存記事は残す |
| 更新後に古い画面 | アプリの「更新する」通知でSWを更新。緊急時はブラウザのサイトデータ削除（保存も消えることを事前説明） |
| 権利者の停止・削除要請 | 対象をsources/sourceInfoから削除し、Zod許可IDも更新してデプロイ。Runtime Cacheの当該URLキーとVercel CDNをpurge。端末の過去メタデータはスキーマ検証で読み込み拒否されるが、他の保存記事まで失わない移行を追加する。無断で連絡は送らない |

## ロールバック

Vercelの直前の正常デプロイへ戻す。Gitコミットを識別し、許諾停止対象を復活させない。ストレージv1の変更には移行を設計してからリリースする。既存の端末保存を無条件削除しない。

## iPhone Safari 実機チェック（未実施）

- [ ] 実機機種・iOS版・URL・Git SHA・日時を記録
- [ ] Safariで初回取得、カテゴリ、検索、配信元選択を操作
- [ ] 保存/既読→Safari終了→再起動で保持
- [ ] 元記事を開き、外部広告の注意文とSafariリーダー案内を確認
- [ ] 前/次/閉じる・キーボード表示・スクロール復元を確認
- [ ] ライト/ダーク・文字大・375px相当幅で横はみ出しなし
- [ ] 共有→ホーム画面に追加→アイコンからstandalone起動
- [ ] 機内モード→アプリシェル・保存記事・キャッシュ表示→復帰
- [ ] 画面上下のsafe areaと下部タブの操作性を確認

この全項目と requirements.md の受け入れ条件を確認して初めてPhase 1完成とする。
