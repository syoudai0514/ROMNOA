import { XMLParser, XMLValidator } from "fast-xml-parser";
import { yahooArticleUrl, yahooArticleSchema } from "../src/lib/yahoo-model.js";

export function parseYahooTopics(xml: string) {
  if (
    Buffer.byteLength(xml) > 200000 ||
    /<!\s*(DOCTYPE|ENTITY)/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw Error("invalid_feed");
  const root = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
  }).parse(xml);
  const raw = root?.rss?.channel?.item;
  const rows = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const articles = rows
    .slice(0, 30)
    .flatMap((item: Record<string, unknown>) => {
      const comments = typeof item.comments === "string" ? item.comments : "";
      const id = comments.match(
        /^https:\/\/news\.yahoo\.co\.jp\/articles\/([a-f0-9]{40})\/comments$/,
      )?.[1];
      const url =
        id && yahooArticleUrl(`https://news.yahoo.co.jp/articles/${id}`);
      const title =
        typeof item.title === "string" ? item.title.trim().slice(0, 500) : "";
      const date =
        typeof item.pubDate === "string" ? Date.parse(item.pubDate) : NaN;
      if (!url || !title) return [];
      return [
        yahooArticleSchema.parse({
          id: url,
          url,
          title,
          summary: "",
          image: null,
          category: "domestic",
          origin: "topic",
          publishedAt: Number.isFinite(date)
            ? new Date(date).toISOString()
            : null,
        }),
      ];
    });
  if (!articles.length) throw Error("empty_topics");
  return [...new Map(articles.map((a) => [a.id, a])).values()];
}
export async function handleYahooTopics(
  request: Request,
  fetcher: typeof fetch = fetch,
  enabled = true,
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers },
    );
  if (!enabled)
    return Response.json(
      { error: "この機能は現在利用できません。" },
      { status: 403, headers },
    );
  try {
    const response = await fetcher(
      "https://news.yahoo.co.jp/rss/topics/top-picks.xml",
      { redirect: "error", signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok || Number(response.headers.get("content-length")) > 200000)
      throw Error("unavailable");
    if (!response.body) throw Error("unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 200000) throw Error("too_large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const xml = Buffer.concat(chunks).toString("utf8");
    return Response.json({ articles: parseYahooTopics(xml) }, { headers });
  } catch {
    return Response.json(
      { error: "トピックスを取得できませんでした。" },
      { status: 503, headers },
    );
  }
}
