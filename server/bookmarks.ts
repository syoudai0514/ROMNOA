import { createHash } from "node:crypto";
import { getCache } from "@vercel/functions";
import { z } from "zod";
import { readerArticleTarget } from "../src/lib/reader-model.js";
import type { Article } from "../src/lib/model.js";

const countsSchema = z.record(
  z.string(),
  z.number().int().min(0).max(1_000_000_000),
);
const entrySchema = z.object({
  counts: countsSchema.nullable(),
  at: z.number(),
});
type Entry = z.infer<typeof entrySchema>;
export async function fetchBookmarkCounts(
  articles: Article[],
  fetcher: typeof fetch = fetch,
) {
  if (
    articles.length > 220 ||
    articles.some((a) => readerArticleTarget(a.id)?.sourceId !== a.sourceId)
  )
    throw new Error("invalid_metric_target");
  const urls = [...new Set(articles.map((a) => a.id))];
  const chunks = Array.from({ length: Math.ceil(urls.length / 40) }, (_, i) =>
    urls.slice(i * 40, (i + 1) * 40),
  );
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const url = new URL("https://bookmark.hatenaapis.com/count/entries");
      for (const article of chunk) url.searchParams.append("url", article);
      const res = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(3500),
        headers: { Accept: "application/json" },
      });
      if (
        !res.ok ||
        !res.body ||
        Number(res.headers.get("content-length")) > 65536
      ) {
        await res.body?.cancel();
        throw new Error("metrics_unavailable");
      }
      const reader = res.body.getReader(),
        parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 65536) throw new Error("metrics_too_large");
          parts.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const counts = countsSchema.parse(
        JSON.parse(Buffer.concat(parts).toString("utf8")),
      );
      if (chunk.some((id) => counts[id] === undefined))
        throw new Error("metrics_incomplete");
      return Object.fromEntries(chunk.map((id) => [id, counts[id]]));
    }),
  );
  return Object.assign({}, ...results) as Record<string, number>;
}
export class BookmarkMetrics {
  private memory = new Map<string, Entry>();
  private pending = new Map<string, Promise<Record<string, number> | null>>();
  constructor(
    private load = fetchBookmarkCounts,
    private now = Date.now,
  ) {}
  async get(articles: Article[]) {
    if (!articles.length) return {};
    const key = createHash("sha256")
      .update(
        articles
          .map((a) => a.id)
          .sort()
          .join("\n"),
      )
      .digest("hex");
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = (async () => {
      const cache = process.env.VERCEL
        ? getCache({ namespace: "romnoa-bookmark-counts-v1" })
        : null;
      let old: Entry | undefined;
      try {
        const p = entrySchema.safeParse(
          cache ? await cache.get(key) : this.memory.get(key),
        );
        if (p.success) old = p.data;
      } catch {
        console.error("ROMNOA metrics_cache_read_failed");
      }
      const now = this.now();
      if (
        old &&
        now - old.at >= 0 &&
        now - old.at < (old.counts ? 600000 : 60000)
      )
        return old.counts;
      let counts: Record<string, number> | null;
      try {
        counts = await this.load(articles);
      } catch {
        counts = null;
        console.error("ROMNOA metrics_fetch_failed");
      }
      const entry = { counts, at: now };
      try {
        if (cache)
          await cache.set(key, entry, {
            ttl: 86400,
            name: "ROMNOA bookmark counts",
          });
        else {
          this.memory.delete(key);
          this.memory.set(key, entry);
          if (this.memory.size > 64)
            this.memory.delete(this.memory.keys().next().value!);
        }
      } catch {
        console.error("ROMNOA metrics_cache_write_failed");
      }
      return counts;
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
}
export const bookmarkMetrics = new BookmarkMetrics();
