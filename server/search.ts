import { createHash } from "node:crypto";
import { getCache } from "@vercel/functions";
import { DomUtils } from "htmlparser2";
import { z } from "zod";
import {
  articleSchema,
  sourceInfo,
  newest,
  type Article,
} from "../src/lib/model.js";
import { readerArticleTarget } from "../src/lib/reader-model.js";
import {
  MAX_SEARCH_PAGE,
  normalizeSearch,
  validSearch,
  searchCollection,
  type SearchResponse,
  type SearchScope,
  searchScopeSchema,
  matchesSearch,
} from "../src/lib/search-model.js";
import { parseIndexMetadata } from "./discovery.js";
import { searchTextService } from "./search-content.js";
import { bookmarkMetrics } from "./bookmarks.js";

type SourceId = Article["sourceId"];
const AGE = 86400000;
const MAX_BYTES = 2000000;
const entrySchema = z.object({
  articles: z.array(articleSchema).max(100),
  hasNext: z.boolean(),
  fetchedAt: z.number(),
  checkedAt: z.number(),
  failed: z.boolean(),
});
export type SearchEntry = z.infer<typeof entrySchema>;
export interface SearchCache {
  get(key: string): Promise<SearchEntry | undefined>;
  set(key: string, value: SearchEntry): Promise<void>;
}
export class MemorySearchCache implements SearchCache {
  private data = new Map<string, SearchEntry>();
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: SearchEntry) {
    this.data.delete(key);
    this.data.set(key, value);
    if (this.data.size > 128) this.data.delete(this.data.keys().next().value!);
  }
}
function runtimeCache(): SearchCache {
  if (!process.env.VERCEL) return new MemorySearchCache();
  const cache = getCache({ namespace: "romnoa-search-v1" });
  return {
    async get(key) {
      const p = entrySchema.safeParse(await cache.get(key));
      return p.success ? p.data : undefined;
    },
    async set(key, value) {
      await cache.set(key, value, {
        ttl: 86400,
        name: "ROMNOA search metadata",
      });
    },
  };
}
export function collectionFor(query: string, page: number) {
  return `search:${createHash("sha256")
    .update(`${normalizeSearch(query)}\n${page}`)
    .digest("hex")}`;
}
export function parseSearchIndex(
  html: string,
  sourceId: SourceId,
  query: string,
  page: number,
) {
  const parsed = parseIndexMetadata(html, sourceId);
  const title = DomUtils.findOne(
    (el) => el.name === "title",
    parsed.doc.children,
  );
  if (
    !title ||
    !normalizeSearch(DomUtils.textContent(title)).includes(
      normalizeSearch(query),
    ) ||
    !DomUtils.textContent(title).includes("を含む記事")
  )
    throw new Error("search_structure_changed");
  const base = sourceInfo.find((s) => s.id === sourceId)!.url;
  const hasNext =
    page < MAX_SEARCH_PAGE &&
    DomUtils.findAll((el) => el.name === "a", parsed.doc.children).some(
      (el) => {
        try {
          const u = new URL(el.attribs.href || "", base),
            host = new URL(base).hostname;
          return (
            u.protocol === "https:" &&
            u.hostname === host &&
            !u.username &&
            !u.password &&
            !u.port &&
            u.pathname.startsWith("/search/") &&
            normalizeSearch(decodeURIComponent(u.pathname.slice(8))) ===
              normalizeSearch(query) &&
            u.searchParams.get("p") === String(page + 1) &&
            [...u.searchParams.keys()].every((k) => k === "p")
          );
        } catch {
          return false;
        }
      },
    );
  return { articles: parsed.articles, hasNext };
}
export async function fetchSearch(
  sourceId: SourceId,
  query: string,
  page: number,
  fetcher: typeof fetch = fetch,
) {
  if (
    !sourceInfo.some((s) => s.id === sourceId) ||
    !validSearch(query) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > MAX_SEARCH_PAGE
  )
    throw new Error("search_not_allowed");
  const base = sourceInfo.find((s) => s.id === sourceId)!.url;
  const url = `${base}search/${encodeURIComponent(normalizeSearch(query))}?p=${page}`;
  const res = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: "text/html",
      "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
    },
  });
  if (
    !res.ok ||
    !res.body ||
    !/text\/html|application\/xhtml\+xml/i.test(
      res.headers.get("content-type") || "",
    )
  ) {
    await res.body?.cancel();
    throw new Error("search_unavailable");
  }
  if (Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body.cancel();
    throw new Error("search_too_large");
  }
  const reader = res.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("search_too_large");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return parseSearchIndex(
    Buffer.concat(parts).toString("utf8"),
    sourceId,
    query,
    page,
  );
}
export class SearchService {
  private pending = new Map<
    string,
    Promise<{ entry: SearchEntry; status: "ok" | "cached" | "error" }>
  >();
  constructor(
    private cache: SearchCache,
    private load = fetchSearch,
    private now = Date.now,
    private metrics = (articles: Article[]) => bookmarkMetrics.get(articles),
    private bodyText = (article: Article, signal: AbortSignal) =>
      searchTextService.get(article, signal),
  ) {}
  private async cached(key: string) {
    try {
      const p = entrySchema.safeParse(await this.cache.get(key));
      return p.success ? p.data : undefined;
    } catch {
      console.error("ROMNOA search_cache_read_failed");
    }
  }
  private async source(sourceId: SourceId, query: string, page: number) {
    const key = `${collectionFor(query, page)}:${sourceId}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = (async () => {
      const now = this.now(),
        old = await this.cached(key);
      const usable =
        old && now - old.fetchedAt >= -60000 && now - old.fetchedAt < AGE;
      if (
        old &&
        now - old.checkedAt >= 0 &&
        now - old.checkedAt < (old.failed ? 60000 : 600000) &&
        (usable || old.failed)
      )
        return {
          entry: usable
            ? old
            : { ...old, articles: [], hasNext: false, fetchedAt: 0 },
          status: old.failed
            ? usable
              ? ("cached" as const)
              : ("error" as const)
            : ("ok" as const),
        };
      let entry: SearchEntry, status: "ok" | "cached" | "error";
      try {
        const data = await this.load(sourceId, query, page);
        entry = entrySchema.parse({
          ...data,
          checkedAt: now,
          fetchedAt: now,
          failed: false,
        });
        status = "ok";
      } catch {
        console.error("ROMNOA search_fetch_failed", sourceId);
        entry = {
          articles: usable ? old.articles : [],
          hasNext: usable ? old.hasNext : false,
          fetchedAt: usable ? old.fetchedAt : 0,
          checkedAt: now,
          failed: true,
        };
        status = usable ? "cached" : "error";
      }
      try {
        await this.cache.set(key, entry);
      } catch {
        console.error("ROMNOA search_cache_write_failed");
      }
      return { entry, status };
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
    page = 1,
    ids: SourceId[] = ["hamusoku", "alfalfa"],
    scope: SearchScope = "title",
  ): Promise<SearchResponse> {
    if (
      !validSearch(query) ||
      !searchScopeSchema.safeParse(scope).success ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > MAX_SEARCH_PAGE ||
      !ids.length ||
      ids.length > 2 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !sourceInfo.some((s) => s.id === id))
    )
      throw new Error("invalid_search_request");
    const q = normalizeSearch(query);
    const results = await Promise.all(
      ids.map(async (id) => ({ id, ...(await this.source(id, q, page)) })),
    );
    const candidates = [
      ...new Map(
        results.flatMap((r) => r.entry.articles).map((a) => [a.id, a]),
      ).values(),
    ].sort(newest);
    // The publisher index supplies candidates, never proof that the story matches.
    // Title matching is cheap. Only missing title words require a clean body fetch.
    const matching = new Set<string>();
    let unverifiedCount = 0,
      next = 0;
    const signal = AbortSignal.timeout(22000);
    await Promise.all(
      Array.from({ length: scope === "body" ? 6 : 1 }, async () => {
        while (next < candidates.length) {
          const article = candidates[next++];
          if (matchesSearch(article.title, q)) {
            matching.add(article.id);
            continue;
          }
          if (scope === "title") continue;
          if (signal.aborted) {
            unverifiedCount++;
            continue;
          }
          const body = await this.bodyText(article, signal).catch(() => null);
          if (body === null) {
            unverifiedCount++;
            continue;
          }
          if (matchesSearch(`${article.title}\n${body}`, q))
            matching.add(article.id);
        }
      }),
    );
    const articles = candidates.filter((a) => matching.has(a.id));
    const bookmarks = await this.metrics(articles).catch(() => null);
    return {
      bookmarks,
      scope,
      unverifiedCount,
      excludedCount: candidates.length - articles.length - unverifiedCount,
      query: q,
      page,
      collection: collectionFor(q, page),
      articles,
      sources: results.map((r) => ({
        id: r.id,
        status: r.status,
        fetchedAt: r.entry.fetchedAt
          ? new Date(r.entry.fetchedAt).toISOString()
          : null,
      })),
      nextSources:
        page < MAX_SEARCH_PAGE
          ? results.filter((r) => r.entry.hasNext).map((r) => r.id)
          : [],
      generatedAt: new Date(this.now()).toISOString(),
    };
  }
  async findKnown(id: string, collection: string) {
    const target = readerArticleTarget(id);
    if (!target || !searchCollection.test(collection)) return;
    const entry = await this.cached(`${collection}:${target.sourceId}`);
    if (
      !entry ||
      this.now() - entry.fetchedAt < -60000 ||
      this.now() - entry.fetchedAt >= AGE
    )
      return;
    return entry.articles.find(
      (a) => a.id === id && a.sourceId === target.sourceId,
    );
  }
}
export const searchService = new SearchService(runtimeCache());
export async function handleSearch(
  request: Request,
  service: Pick<SearchService, "get"> = searchService,
  preview = !process.env.VERCEL || process.env.VERCEL_ENV === "preview",
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETのみ利用できます。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const p = new URL(request.url).searchParams,
    query = p.get("q") || "",
    page = Number(p.get("page") || "1"),
    scope = p.get("scope") || "title",
    ids = (p.get("sources")?.split(",") || [
      "hamusoku",
      "alfalfa",
    ]) as SourceId[];
  if (
    !validSearch(query) ||
    !searchScopeSchema.safeParse(scope).success ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > MAX_SEARCH_PAGE ||
    (p.has("page") && !/^[1-9]\d{0,3}$/.test(p.get("page")!)) ||
    [...p.keys()].some(
      (k) =>
        !["q", "page", "sources", "scope"].includes(k) ||
        p.getAll(k).length !== 1,
    ) ||
    !ids.length ||
    ids.length > 2 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !sourceInfo.some((s) => s.id === id))
  )
    return Response.json(
      { error: "検索語（80文字以内）またはページ指定を確認してください。" },
      { status: 400, headers },
    );
  if (scope === "body" && !preview)
    return Response.json(
      { error: "本文検索は個人用プレビュー専用です。" },
      { status: 403, headers },
    );
  try {
    const data = await service.get(query, page, ids, scope as SearchScope);
    return Response.json(data, {
      status: data.sources.every((s) => s.status === "error") ? 503 : 200,
      headers,
    });
  } catch {
    console.error("ROMNOA search_failed");
    return Response.json(
      {
        error:
          "過去記事を検索できませんでした。時間をおいて再試行してください。",
      },
      { status: 503, headers },
    );
  }
}
