import { getCache } from "@vercel/functions";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Parser } from "htmlparser2";
import { z } from "zod";
import {
  yahooCategories,
  yahooArticleSchema,
  yahooArticleUrl,
  yahooImageUrl,
  type YahooArticle,
  type YahooCategory,
  type YahooResponse,
} from "../src/lib/yahoo-model.js";

const MAX_BYTES = 1_000_000;
const TTL = 600_000;
const MAX_AGE = 86_400_000;
const entrySchema = z.object({
  articles: z.array(yahooArticleSchema).max(50),
  fetchedAt: z.number(),
  checkedAt: z.number(),
  failed: z.boolean(),
});
type Entry = z.infer<typeof entrySchema>;
export interface YahooCache {
  get(key: string): Promise<Entry | undefined>;
  set(key: string, entry: Entry): Promise<void>;
}
export class MemoryYahooCache implements YahooCache {
  private data = new Map<string, Entry>();
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, entry: Entry) {
    this.data.set(key, entry);
  }
}
function cacheAdapter(): YahooCache {
  if (!process.env.VERCEL) return new MemoryYahooCache();
  const cache = getCache({ namespace: "romnoa-yahoo-rss-v1" });
  return {
    async get(key) {
      const parsed = entrySchema.safeParse(await cache.get(key));
      return parsed.success ? parsed.data : undefined;
    },
    async set(key, entry) {
      await cache.set(key, entry, { ttl: 86400, name: "ROMNOA Yahoo RSS" });
    },
  };
}
type Node = Record<string, unknown>;
const obj = (n: unknown): Node =>
  n && typeof n === "object" && !Array.isArray(n) ? (n as Node) : {};
function text(n: unknown, max: number) {
  if (typeof n !== "string") return "";
  const out: string[] = [];
  let skip = 0;
  new Parser(
    {
      onopentag(name) {
        if (["script", "style", "iframe", "object"].includes(name)) skip++;
      },
      onclosetag(name) {
        if (["script", "style", "iframe", "object"].includes(name))
          skip = Math.max(0, skip - 1);
      },
      ontext(s) {
        if (!skip) out.push(s);
      },
    },
    { decodeEntities: true },
  ).end(n);
  return out.join("").replace(/\s+/g, " ").trim().slice(0, max);
}
export function parseYahooFeed(
  xml: string,
  category: YahooCategory,
): YahooArticle[] {
  if (Buffer.byteLength(xml) > MAX_BYTES || /<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error("invalid_feed");
  if (XMLValidator.validate(xml) !== true) throw new Error("invalid_xml");
  const root = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
  }).parse(xml);
  const channel = obj(obj(root).rss).channel;
  if (!channel) throw new Error("invalid_channel");
  const raw = obj(channel).item;
  const rows = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const result = rows.slice(0, 50).flatMap((item) => {
    const i = obj(item),
      url = typeof i.link === "string" ? yahooArticleUrl(i.link) : null;
    const title = text(i.title, 500);
    if (!url || !title) return [];
    const ms = typeof i.pubDate === "string" ? Date.parse(i.pubDate) : NaN;
    return [
      yahooArticleSchema.parse({
        id: url,
        url,
        title,
        category,
        summary: text(i.description, 2000),
        // XML attributes in plain item.image contain &amp; separators. Decode the
        // feed text before URL validation; keep DTD/entity expansion disabled.
        image:
          typeof i.image === "string"
            ? yahooImageUrl(text(i.image, 2048))
            : null,
        publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
      }),
    ];
  });
  if (!result.length) throw new Error("empty_feed");
  return [...new Map(result.map((a) => [a.id, a])).values()];
}
export async function fetchYahooFeed(
  category: YahooCategory,
  fetcher: typeof fetch = fetch,
) {
  if (!yahooCategories.some((c) => c.id === category))
    throw new Error("category_not_allowed");
  const res = await fetcher(
    `https://news.yahoo.co.jp/rss/categories/${category}.xml`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: "application/rss+xml, application/xml",
        "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
      },
    },
  );
  if (!res.ok || !res.body) throw new Error("upstream_failed");
  if (Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body.cancel();
    throw new Error("feed_too_large");
  }
  const reader = res.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BYTES) throw new Error("feed_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return parseYahooFeed(Buffer.concat(chunks).toString("utf8"), category);
}
export class YahooService {
  private pending: Promise<YahooResponse> | undefined;
  constructor(
    private cache: YahooCache,
    private load = fetchYahooFeed,
    private now = Date.now,
  ) {}
  private async source(id: YahooCategory): Promise<{
    articles: YahooArticle[];
    source: YahooResponse["sources"][number];
  }> {
    let old: Entry | undefined;
    try {
      old = await this.cache.get(id);
    } catch {
      /* bounded memory-free fallback */
    }
    const now = this.now(),
      usable = old && now - old.fetchedAt <= MAX_AGE && old.fetchedAt <= now;
    let entry: Entry;
    if (old && now - old.checkedAt < (old.failed ? 60_000 : TTL)) {
      entry = { ...old, articles: usable ? old.articles : [] };
    } else {
      try {
        entry = {
          articles: await this.load(id),
          fetchedAt: now,
          checkedAt: now,
          failed: false,
        };
      } catch {
        entry = {
          articles: usable && old ? old.articles : [],
          fetchedAt: usable && old ? old.fetchedAt : 0,
          checkedAt: now,
          failed: true,
        };
      }
      try {
        await this.cache.set(id, entry);
      } catch {
        /* next request can retry */
      }
    }
    return {
      articles: entry.articles,
      source: {
        id,
        status: entry.failed
          ? entry.articles.length
            ? "cached"
            : "error"
          : "ok",
        fetchedAt: entry.fetchedAt
          ? new Date(entry.fetchedAt).toISOString()
          : null,
      },
    };
  }
  get(): Promise<YahooResponse> {
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async collect(): Promise<YahooResponse> {
    const queue = [...yahooCategories];
    const results: Awaited<ReturnType<YahooService["source"]>>[] = [];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const category = queue.shift()!;
          results.push(await this.source(category.id));
        }
      }),
    );
    const articles = [
      ...new Map(
        results.flatMap((r) => r.articles).map((a) => [a.id, a]),
      ).values(),
    ];
    articles.sort(
      (a, b) =>
        (Date.parse(b.publishedAt || "") || 0) -
        (Date.parse(a.publishedAt || "") || 0),
    );
    return {
      articles,
      sources: yahooCategories.map(
        (c) => results.find((r) => r.source.id === c.id)!.source,
      ),
      generatedAt: new Date(this.now()).toISOString(),
    };
  }
}
export const yahooService = new YahooService(cacheAdapter());
export async function handleYahoo(request: Request, service = yahooService) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  if (new URL(request.url).search)
    return Response.json(
      { error: "指定できないパラメータです。" },
      { status: 400, headers },
    );
  try {
    const result = await service.get();
    if (result.sources.every((s) => s.status === "error"))
      return Response.json(
        { error: "Yahooニュースを取得できませんでした。" },
        { status: 503, headers },
      );
    return Response.json(result, { headers });
  } catch {
    return Response.json(
      { error: "ニュースを取得できませんでした。" },
      { status: 503, headers },
    );
  }
}
