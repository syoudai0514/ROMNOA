# ADR 002: Vercel Function + 端末保存

採用日: 2026-10-20

UIと固定RSS集約APIだけを配置し、Supabaseやログインを初期必須にしない。端末保存は小規模な構造化メタデータに限定するためlocalStorageを使用する。保存は上限を設け破損/容量不足を通知する。本文保存や大量履歴が必要になった時点でIndexedDBへ移す。

サーバーキャッシュはVercel Runtime Cacheを利用し、CDNとブラウザにも障害時のデータを残す。無料枠内を保証するものではなく、使用量を運用で確認する。永続DBとしてRuntime Cacheを扱わない。
