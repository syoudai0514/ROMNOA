import { createHash } from "node:crypto";
import { getCache } from "@vercel/functions";
import { Parser } from "htmlparser2";
import { z } from "zod";
import {
  normalizeSearch,
  validSearch,
  matchesSearch,
} from "../src/lib/search-model.js";
import {
  yahooArticleSchema,
  yahooArticleUrl,
  yahooImageUrl,
  type YahooArticle,
  type YahooCategory,
  type YahooSearchResponse,
} from "../src/lib/yahoo-model.js";

const MAX_BYTES = 2_000_000;
const DAY = 86_400_000;
const stateSchema = z.object({
  searchConditions: z.object({ query: z.string() }),
  search: z.object({
    totalResults: z.number().int().min(0).max(10000000),
    startIndex: z.literal(1),
    isError: z.literal(false),
    contents: z.array(z.unknown()).max(200),
  }),
});
const itemSchema = z.object({
  viewType: z.literal(0),
  serviceId: z.literal("news"),
  contentId: z.string().regex(/^[a-f0-9]{40}$/),
  permalink: z.string().max(200),
  highlightSearchText: z.object({
    headline: z.string().max(5000),
    body: z.string().max(10000).optional(),
  }),
  thumbnail: z.object({ url: z.string().max(2048).optional() }).optional(),
  categories: z
    .array(z.object({ id: z.string().max(40) }))
    .max(10)
    .optional(),
  media: z.object({ name: z.string().max(300) }).optional(),
  publishTime: z
    .object({ date: z.string().max(30), time: z.string().max(20) })
    .optional(),
});
function plain(raw: string, limit: number) {
  const parts: string[] = [];
  let skip = 0;
  new Parser(
    {
      onopentag(n) {
        if (["script", "style", "iframe"].includes(n)) skip++;
      },
      onclosetag(n) {
        if (["script", "style", "iframe"].includes(n))
          skip = Math.max(0, skip - 1);
      },
      ontext(t) {
        if (!skip) parts.push(t);
      },
    },
    { decodeEntities: true },
  ).end(raw);
  return parts
    .join("")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
export function parseYahooSearch(html: string, query: string) {
  if (Buffer.byteLength(html) > MAX_BYTES) throw new Error("search_too_large");
  let script = "",
    collecting = false;
  const states: unknown[] = [];
  // Read only the page's serialized search state. Never execute a script or call
  // Yahoo's internal /api endpoints. Ranking/ad/recommendation state is ignored.
  new Parser(
    {
      onopentag(name) {
        if (name === "script") {
          collecting = true;
          script = "";
        }
      },
      ontext(text) {
        if (collecting) script += text;
      },
      onclosetag(name) {
        if (name !== "script" || !collecting) return;
        collecting = false;
        const match = script.match(
          /^\s*window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
        );
        if (match) {
          try {
            states.push(JSON.parse(match[1]));
          } catch {
            /* reject below */
          }
        }
      },
    },
    { decodeEntities: false },
  ).end(html);
  if (states.length !== 1) throw new Error("search_structure_changed");
  const state = stateSchema.parse(states[0]);
  if (normalizeSearch(state.searchConditions.query) !== normalizeSearch(query))
    throw new Error("search_query_mismatch");
  return parseSearchItems(state.search.contents, state.search.totalResults);
}
function parseSearchItems(contents: unknown[], totalResults: number) {
  const categoryMap: Record<string, YahooCategory> = {
    dom: "domestic",
    domestic: "domestic",
    world: "world",
    bus: "business",
    business: "business",
    ent: "entertainment",
    entertainment: "entertainment",
    spo: "sports",
    sports: "sports",
    sci: "science",
    science: "science",
    it: "it",
    life: "life",
    loc: "local",
    local: "local",
  };
  const articles: YahooArticle[] = [];
  for (const raw of contents) {
    const parsed = itemSchema.safeParse(raw);
    if (!parsed.success) continue; // includes viewType=1 advertising slots
    const i = parsed.data,
      url = yahooArticleUrl(i.permalink);
    if (!url || !url.endsWith(`/${i.contentId}`)) continue;
    const title = plain(i.highlightSearchText.headline, 500);
    if (!title) continue;
    articles.push(
      yahooArticleSchema.parse({
        id: url,
        url,
        title,
        summary: plain(i.highlightSearchText.body || "", 2000),
        image: i.thumbnail?.url ? yahooImageUrl(i.thumbnail.url) : null,
        category:
          i.categories?.map((c) => categoryMap[c.id]).find(Boolean) ||
          "entertainment",
        publishedAt: null, // The result has no unambiguous year; do not invent one.
        origin: "search",
        displayDate: i.publishTime
          ? plain(`${i.publishTime.date} ${i.publishTime.time}`, 40)
          : undefined,
        provider: i.media ? plain(i.media.name, 100) : undefined,
      }),
    );
  }
  if (totalResults > 0 && !articles.length)
    throw new Error("search_structure_changed");
  return {
    articles: [...new Map(articles.map((a) => [a.id, a])).values()].slice(
      0,
      50,
    ),
    providerTotal: totalResults,
  };
}
export async function fetchYahooSearch(
  query: string,
  fetcher: typeof fetch = fetch,
  limit = 50,
): Promise<{ articles: YahooArticle[]; providerTotal: number; incomplete?: boolean; supplemented?: number }> {
  if (!validSearch(query)) throw new Error("invalid_query");
  const response = await fetcher(
    `https://news.yahoo.co.jp/search?p=${encodeURIComponent(normalizeSearch(query))}`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "text/html",
        "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
      },
    },
  );
  if (
    !response.ok ||
    !response.body ||
    !/text\/html/i.test(response.headers.get("content-type") || "")
  ) {
    await response.body?.cancel();
    throw new Error("search_unavailable");
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body.cancel();
    throw new Error("search_too_large");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("search_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const first = parseYahooSearch(Buffer.concat(chunks).toString("utf8"), query);
  if (limit <= 50 || first.providerTotal <= 50) return first;
  // Leave time to return partial results before the function deadline.
  const deadline = Date.now() + 38_000;
  const starts = Array.from(
    { length: Math.ceil(Math.min(limit, first.providerTotal) / 50) - 1 },
    (_, i) => 51 + i * 50,
  );
  async function fetchPage(start: number, category = "", partitionQuery = normalizeSearch(query)) {
      const params = new URLSearchParams({
        start: String(start),
        query: partitionQuery,
        categories: category,
        qrw: "true",
        results: "50",
        ei: "utf-8",
        source: "other",
      });
      const response = await fetcher(
        `https://news.yahoo.co.jp/api/public/search-feed?${params}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - Date.now()))),
          headers: { Accept: "application/json" },
        },
      );
      if (
        !response.ok ||
        !response.body ||
        !/application\/json/i.test(response.headers.get("content-type") || "")
      ) {
        await response.body?.cancel();
        throw Error("search_unavailable");
      }
      if (Number(response.headers.get("content-length")) > MAX_BYTES) {
        await response.body.cancel();
        throw Error("search_too_large");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BYTES) throw Error("search_too_large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      const data = z
        .object({
          totalResults: z.number().int().min(0).max(10000000),
          startIndex: z.literal(start),
          contents: z.array(z.unknown()).max(200),
        })
        .parse(JSON.parse(bytes.toString("utf8")));
      return parseSearchItems(data.contents, data.totalResults);
  }
  const found = new Map(first.articles.map((article) => [article.id, article]));
  const add = (articles: YahooArticle[]) => {
    for (const article of articles) {
      if (found.size >= limit) break;
      if (!found.has(article.id)) found.set(article.id, article);
    }
  };
  let incomplete = false;
  // Fetch global results in order, retaining successful pages on failure.
  for (let i = 0; i < starts.length; i += 10) {
    if (Date.now() >= deadline) {
      incomplete = true;
      break;
    }
    const batch = await Promise.allSettled(starts.slice(i, i + 10).map((start) => fetchPage(start)));
    for (const result of batch) {
      if (result.status === "fulfilled") add(result.value.articles);
      else incomplete = true;
    }
    if (incomplete) break;
  }
  const beforeCategories = found.size;
  const target = Math.min(limit, first.providerTotal);
  // Yahoo supports positive and negative terms. If their counts partition the
  // parent and their first pages do not overlap, use independent result windows
  // to get older candidates. Always filter against the original query later.
  if (incomplete && limit > 1000 && first.providerTotal > 1000 && found.size < target) {
    type Partition = { query: string; total: number; used: string[]; first: YahooArticle[]; blocked?: boolean };
    const pivots = ["写真", "公開", "さん", "画像", "女性"];
    const partitions: Partition[] = [{ query: normalizeSearch(query), total: first.providerTotal, used: [], first: first.articles }];
    for (let splits = 0; splits < 4 && Date.now() < deadline; splits++) {
      const index = partitions.findIndex((part) => part.total > 1000 && !part.blocked);
      if (index < 0) break;
      const parent = partitions[index];
      const words = pivots.filter((word) => !parent.used.includes(word) && !normalizeSearch(query).includes(word));
      if (!words.length) { parent.blocked = true; continue; }
      const probes = await Promise.allSettled(words.flatMap((word) => [
        fetchPage(1, "", `${parent.query} ${word}`),
        fetchPage(1, "", `${parent.query} -${word}`),
      ]));
      let best: { word: string; yes: { articles: YahooArticle[]; providerTotal: number }; no: { articles: YahooArticle[]; providerTotal: number } } | null = null;
      for (let i = 0; i < words.length; i++) {
        const yes = probes[i * 2], no = probes[i * 2 + 1];
        if (yes.status !== "fulfilled" || no.status !== "fulfilled") continue;
        if (!yes.value.providerTotal || !no.value.providerTotal || yes.value.providerTotal + no.value.providerTotal !== parent.total) continue;
        const ids = new Set(yes.value.articles.map((article) => article.id));
        if (no.value.articles.some((article) => ids.has(article.id))) continue;
        if (!best || Math.max(yes.value.providerTotal, no.value.providerTotal) < Math.max(best.yes.providerTotal, best.no.providerTotal))
          best = { word: words[i], yes: yes.value, no: no.value };
      }
      if (!best) { parent.blocked = true; continue; }
      const used = [...parent.used, best.word];
      partitions.splice(index, 1,
        { query: `${parent.query} ${best.word}`, total: best.yes.providerTotal, used, first: best.yes.articles },
        { query: `${parent.query} -${best.word}`, total: best.no.providerTotal, used, first: best.no.articles },
      );
    }
    if (partitions.length > 1) {
      for (const part of partitions) add(part.first);
      for (let start = 51; start <= 1000 && found.size < target && Date.now() < deadline; start += 50) {
        const active = partitions.filter((part) => part.total >= start);
        if (!active.length) break;
        const batch = await Promise.allSettled(active.map((part) => fetchPage(start, "", part.query)));
        for (const result of batch) if (result.status === "fulfilled") add(result.value.articles);
      }
    }
  }
  // Yahoo's news search does not expose a verified date range. Its own category
  // filter does provide independent result windows, which can contain older
  // items beyond the global window. Merge unique IDs, keeping the original order.
  if (incomplete && limit > 1000 && first.providerTotal > 1000 && found.size < target) {
    const categories = ["domestic", "world", "business", "entertainment", "sports", "it", "science", "life", "local"];
    let active = categories;
    for (let start = 1; start <= 1000 && active.length && found.size < target && Date.now() < deadline; start += 50) {
      const batch = await Promise.allSettled(active.map((category) => fetchPage(start, category)));
      const next: string[] = [];
      for (let i = 0; i < batch.length; i++) {
        const result = batch[i];
        if (result.status !== "fulfilled") continue;
        add(result.value.articles);
        if (result.value.providerTotal > start + 49) next.push(active[i]);
      }
      active = next;
    }
  }
  return {
    articles: [...found.values()],
    providerTotal: first.providerTotal,
    incomplete,
    supplemented: found.size - beforeCategories,
  };
}
const entrySchema = z.object({
  articles: z.array(yahooArticleSchema).max(2000),
  providerTotal: z.number().int().min(0).max(10000000),
  incomplete: z.boolean().optional(),
  supplemented: z.number().int().min(0).max(2000).optional(),
  fetchedAt: z.number(),
  checkedAt: z.number(),
  failed: z.boolean(),
});
type Entry = z.infer<typeof entrySchema>;
export interface YahooSearchCache {
  get(key: string): Promise<Entry | undefined>;
  set(key: string, entry: Entry): Promise<void>;
}
export class MemoryYahooSearchCache implements YahooSearchCache {
  private data = new Map<string, Entry>();
  async get(k: string) {
    return this.data.get(k);
  }
  async set(k: string, e: Entry) {
    this.data.delete(k);
    this.data.set(k, e);
    if (this.data.size > 128) this.data.delete(this.data.keys().next().value!);
  }
}
function cacheAdapter(): YahooSearchCache {
  if (!process.env.VERCEL) return new MemoryYahooSearchCache();
  const cache = getCache({ namespace: "romnoa-yahoo-search-v4" });
  return {
    async get(k) {
      const p = entrySchema.safeParse(await cache.get(k));
      return p.success ? p.data : undefined;
    },
    async set(k, e) {
      await cache.set(k, e, {
        ttl: 86400,
        name: "ROMNOA Yahoo search metadata",
      });
    },
  };
}
export class YahooSearchService {
  private pending = new Map<string, Promise<Entry>>();
  constructor(
    private cache: YahooSearchCache,
    private load = fetchYahooSearch,
    private now = Date.now,
  ) {}
  private async entry(q: string, limit: number): Promise<Entry> {
    const key = createHash("sha256").update(`${q}:${limit}`).digest("hex");
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = (async () => {
      let old: Entry | undefined;
      try {
        const p = entrySchema.safeParse(await this.cache.get(key));
        if (p.success) old = p.data;
      } catch {
        /* isolated */
      }
      const now = this.now(),
        usable =
          old &&
          old.fetchedAt > 0 &&
          now - old.fetchedAt >= 0 &&
          now - old.fetchedAt < DAY;
      if (
        old &&
        now - old.checkedAt >= 0 &&
        now - old.checkedAt < (old.failed || old.incomplete ? 60000 : 600000)
      ) {
        if (!usable) throw new Error("search_unavailable");
        return old;
      }
      let entry: Entry;
      try {
        entry = {
          ...(await this.load(q, undefined, limit)),
          fetchedAt: now,
          checkedAt: now,
          failed: false,
        };
      } catch {
        entry = {
          articles: usable && old ? old.articles : [],
          providerTotal: usable && old ? old.providerTotal : 0,
          incomplete: usable && old ? old.incomplete : false,
          supplemented: usable && old ? old.supplemented : 0,
          fetchedAt: usable && old ? old.fetchedAt : 0,
          checkedAt: now,
          failed: true,
        };
      }
      try {
        await this.cache.set(key, entry);
      } catch {
        /* next request may refresh */
      }
      if (entry.failed && !usable) throw new Error("search_unavailable");
      return entry;
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
  async get(
    query: string,
    scope: "title" | "summary",
    limit = 50,
  ): Promise<YahooSearchResponse> {
    if (!validSearch(query) || !["title", "summary"].includes(scope))
      throw new Error("invalid_query");
    const q = normalizeSearch(query),
      entry = await this.entry(q, limit);
    return {
      query: q,
      scope,
      articles: entry.articles.filter((a) =>
        matchesSearch(
          scope === "title" ? a.title : `${a.title}\n${a.summary}`,
          q,
        ),
      ),
      candidateCount: entry.articles.length,
      providerTotal: entry.providerTotal,
      status: entry.failed ? "cached" : "ok",
      incomplete: entry.incomplete || false,
      supplemented: entry.supplemented || 0,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
    };
  }
}
const service = new YahooSearchService(cacheAdapter());
export async function handleYahooSearch(
  request: Request,
  engine = service,
  enabled = true,
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const p = new URL(request.url).searchParams,
    q = p.get("q") || "",
    scope = p.get("scope") || "title",
    limit = Number(p.get("limit") || 2000);
  if (
    !validSearch(q) ||
    !["title", "summary"].includes(scope) ||
    ![50, 100, 200, 500, 1000, 2000].includes(limit) ||
    [...p.keys()].some(
      (k) => !["q", "scope", "limit"].includes(k) || p.getAll(k).length !== 1,
    )
  )
    return Response.json(
      { error: "検索語は80文字以内で入力してください。" },
      { status: 400, headers },
    );
  if (!enabled)
    return Response.json(
      { error: "この機能は現在利用できません。" },
      { status: 403, headers },
    );
  try {
    return Response.json(
      await engine.get(q, scope as "title" | "summary", limit),
      {
        headers,
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "Yahooニュースを検索できませんでした。時間をおいて再試行してください。",
      },
      { status: 503, headers },
    );
  }
}
