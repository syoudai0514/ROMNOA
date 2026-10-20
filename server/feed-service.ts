import { getCache } from "@vercel/functions";
import {
  articleSchema,
  newest,
  type Article,
  type FeedResponse,
} from "../src/lib/model.js";
import { z } from "zod";
import { MAX_BYTES, parseFeed } from "./parser.js";
import { sources, type Source } from "./sources.js";

export const INTERVAL = 600_000;
const MAX_AGE = 86_400_000;
const entrySchema = z.object({
  articles: z.array(articleSchema).max(100),
  fetchedAt: z.number(),
  checkedAt: z.number(),
  failed: z.boolean(),
});
export type Entry = z.infer<typeof entrySchema>;
export interface FeedCache {
  get(key: string): Promise<Entry | undefined>;
  set(key: string, value: Entry): Promise<void>;
}
export class MemoryCache implements FeedCache {
  private data = new Map<string, Entry>();
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: Entry) {
    this.data.set(key, value);
  }
}
const localCache = new MemoryCache();
function cacheAdapter(): FeedCache {
  if (!process.env.VERCEL) return localCache;
  const cache = getCache({ namespace: "romnoa-feed-v1" });
  return {
    async get(key) {
      const parsed = entrySchema.safeParse(await cache.get(key));
      return parsed.success ? parsed.data : undefined;
    },
    async set(key, value) {
      await cache.set(key, value, { ttl: 86400, name: "ROMNOA source feed" });
    },
  };
}

export async function fetchFeed(
  source: Source,
  fetcher: typeof fetch = fetch,
): Promise<Article[]> {
  const allowed = sources.find(
    (s) =>
      s.id === source.id &&
      s.url === source.url &&
      s.hostname === source.hostname,
  );
  if (!allowed) throw new Error("source_not_allowed");
  const res = await fetcher(allowed.url, {
    redirect: "error",
    signal: AbortSignal.timeout(6000),
    headers: {
      Accept:
        "application/rss+xml, application/atom+xml, application/rdf+xml, text/xml",
      "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
    },
  });
  if (!res.ok || !res.body) throw new Error(`upstream_${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body.cancel();
    throw new Error("feed_too_large");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("feed_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return parseFeed(Buffer.concat(chunks).toString("utf8"), allowed);
}

export class FeedService {
  private pending = new Map<
    string,
    Promise<{ entry: Entry; status: "ok" | "cached" | "error" }>
  >();
  constructor(
    private cache: FeedCache,
    private load: (source: Source) => Promise<Article[]> = fetchFeed,
    private now = Date.now,
  ) {}

  private async source(source: Source) {
    const existing = this.pending.get(source.id);
    if (existing) return existing;
    const work = this.update(source);
    this.pending.set(source.id, work);
    try {
      return await work;
    } finally {
      this.pending.delete(source.id);
    }
  }
  private async update(
    source: Source,
  ): Promise<{ entry: Entry; status: "ok" | "cached" | "error" }> {
    const key = source.url;
    let old: Entry | undefined;
    try {
      old = await this.cache.get(key);
    } catch {
      console.error("ROMNOA cache_read_failed", source.id);
    }
    const now = this.now();
    const usable = old && now - old.fetchedAt <= MAX_AGE;
    if (old && now - old.checkedAt < INTERVAL) {
      return {
        entry: usable ? old : { ...old, articles: [] },
        status: old.failed
          ? usable && old.articles.length
            ? "cached"
            : "error"
          : "ok",
      };
    }
    let entry: Entry, status: "ok" | "cached" | "error";
    try {
      const articles = await this.load(source);
      entry = { articles, fetchedAt: now, checkedAt: now, failed: false };
      status = "ok";
    } catch {
      console.error("ROMNOA source_fetch_failed", source.id);
      entry = {
        articles: usable && old ? old.articles : [],
        fetchedAt: usable && old ? old.fetchedAt : 0,
        checkedAt: now,
        failed: true,
      };
      status = entry.articles.length ? "cached" : "error";
    }
    try {
      await this.cache.set(key, entry);
    } catch {
      console.error("ROMNOA cache_write_failed", source.id);
    }
    return { entry, status };
  }
  async get(): Promise<FeedResponse> {
    const results = await Promise.all(
      sources.map(async (s) => ({ source: s, ...(await this.source(s)) })),
    );
    return {
      articles: [
        ...new Map(
          results.flatMap((r) => r.entry.articles).map((a) => [a.id, a]),
        ).values(),
      ].sort(newest),
      sources: results.map((r) => ({
        id: r.source.id,
        status: r.status,
        fetchedAt: r.entry.fetchedAt
          ? new Date(r.entry.fetchedAt).toISOString()
          : null,
      })),
      generatedAt: new Date(this.now()).toISOString(),
    };
  }
}
export const feedService = new FeedService(cacheAdapter());
