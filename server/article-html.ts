import { readerArticleTarget } from "../src/lib/reader-model.js";
import type { Article } from "../src/lib/model.js";
const MAX_HTML = 2_000_000;

export async function fetchArticleHtml(
  article: Article,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const target = readerArticleTarget(article.url);
  if (
    !target ||
    target.sourceId !== article.sourceId ||
    article.id !== target.url
  )
    throw new Error("対応していない記事です。");
  const response = await fetcher(target.url, {
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(6000)])
      : AbortSignal.timeout(10000),
    headers: {
      Accept: "text/html, application/xhtml+xml",
      "User-Agent":
        "ROMNOA/0.2 personal-reader (+https://github.com/syoudai0514/ROMNOA)",
    },
  });
  if (
    !response.ok ||
    !response.body ||
    !/text\/html|application\/xhtml\+xml/i.test(
      response.headers.get("content-type") || "",
    )
  ) {
    await response.body?.cancel();
    throw new Error("配信元から本文を取得できませんでした。");
  }
  if (Number(response.headers.get("content-length")) > MAX_HTML) {
    await response.body.cancel();
    throw new Error("記事が大きすぎるため表示できません。");
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_HTML)
        throw new Error("記事が大きすぎるため表示できません。");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString("utf8");
}
