import { getCache } from "@vercel/functions";
import { parseDocument, DomUtils } from "htmlparser2";
import { z } from "zod";
import {
  articleSchema,
  classify,
  newest,
  sourceInfo,
  type Article,
} from "../src/lib/model.js";
import { readerArticleTarget } from "../src/lib/reader-model.js";
import {
  japanDay,
  validDay,
  validCollection,
  type DiscoveryResponse,
} from "../src/lib/discovery-model.js";

type SourceId = Article["sourceId"];
type Element = Extract<
  ReturnType<typeof parseDocument>["children"][number],
  { attribs: Record<string, string> }
>;
type Kind = "popular" | "date";
const MAX_AGE = 86_400_000;
const MAX_BYTES = 2_000_000;
const POPULAR = {
  hamusoku:
    "https://hamusoku.com/archives/popular_articles.json?limit=5&with_image=1&image_width=320&image_height=290&rangetype=custom&range=6",
  alfalfa: "https://alfalfalfa.com/js/blogparts/pc_pop_ranking.async.js",
} as const;
const dataSchema = z.object({
  articles: z.array(articleSchema).max(100),
  ranks: z
    .array(
      z.object({
        id: z.string().max(2048),
        rank: z.number().int().min(1).max(10),
      }),
    )
    .max(10),
  limited: z.boolean(),
  unavailable: z.boolean().optional(),
});
const entrySchema = dataSchema.extend({
  fetchedAt: z.number(),
  checkedAt: z.number(),
  failed: z.boolean(),
});
export type DiscoveryData = z.infer<typeof dataSchema>;
type Entry = z.infer<typeof entrySchema>;
export interface DiscoveryCache {
  get(key: string): Promise<Entry | undefined>;
  set(key: string, value: Entry): Promise<void>;
}
export class MemoryDiscoveryCache implements DiscoveryCache {
  private values = new Map<string, Entry>();
  async get(key: string) {
    return this.values.get(key);
  }
  async set(key: string, value: Entry) {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > 128)
      this.values.delete(this.values.keys().next().value!);
  }
}
function runtimeCache(): DiscoveryCache {
  if (!process.env.VERCEL) return new MemoryDiscoveryCache();
  const cache = getCache({ namespace: "romnoa-discovery-v1" });
  return {
    async get(key) {
      const parsed = entrySchema.safeParse(await cache.get(key));
      return parsed.success ? parsed.data : undefined;
    },
    async set(key, entry) {
      await cache.set(key, entry, {
        ttl: 86400,
        name: "ROMNOA discovery metadata",
      });
    },
  };
}
const hasClass = (el: Element, name: string) =>
  (el.attribs.class || "").split(/\s+/).includes(name);
const text = (el: Element) =>
  DomUtils.textContent(el).replace(/\s+/g, " ").trim();
function document(html: string) {
  if (Buffer.byteLength(html) > MAX_BYTES)
    throw new Error("discovery_too_large");
  const doc = parseDocument(html);
  const stack = doc.children.map((node) => ({ node, depth: 0 }));
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++count > 60000 || depth > 120)
      throw new Error("discovery_too_complex");
    if ("children" in node)
      for (const child of node.children)
        stack.push({ node: child, depth: depth + 1 });
  }
  return doc;
}
function article(
  raw: string,
  title: string,
  sourceId: SourceId,
  publishedAt: string | null,
): Article | null {
  // The publisher's search page decorates its direct article links with ?cate.
  // Remove that exact empty marker; retain strict rejection of other queries.
  const target = readerArticleTarget(
    sourceId === "alfalfa" && raw.endsWith("?cate") ? raw.slice(0, -5) : raw,
  );
  if (!target || target.sourceId !== sourceId || !title) return null;
  const parsed = articleSchema.safeParse({
    id: target.url,
    url: target.url,
    sourceId,
    title: title.slice(0, 300),
    publishedAt,
    category: classify(title),
  });
  return parsed.success ? parsed.data : null;
}
function localDate(raw: string): string | null {
  const m = raw.match(
    /^(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return null;
  const day = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (!validDay(day) || +m[4] > 23 || +m[5] > 59 || +(m[6] || 0) > 59)
    return null;
  return new Date(
    `${day}T${m[4].padStart(2, "0")}:${m[5]}:${m[6] || "00"}+09:00`,
  ).toISOString();
}
export function parsePopular(input: string, sourceId: SourceId): DiscoveryData {
  const articles: Article[] = [],
    ranks: DiscoveryData["ranks"] = [];
  if (Buffer.byteLength(input) > MAX_BYTES)
    throw new Error("discovery_too_large");
  if (sourceId === "hamusoku") {
    const json = z
      .object({
        articles: z
          .array(
            z.object({
              url: z.string(),
              title: z.string(),
              created_at_ymdhm: z.string().optional(),
            }),
          )
          .max(10),
      })
      .parse(JSON.parse(input));
    json.articles.forEach((item, i) => {
      const a = article(
        item.url,
        item.title,
        sourceId,
        localDate(item.created_at_ymdhm || ""),
      );
      if (!a) throw new Error("invalid_popular_article");
      articles.push(a);
      ranks.push({ id: a.id, rank: i + 1 });
    });
  } else {
    // Decode one JSON string literal. Never eval or execute publisher scripts.
    const literal = input.match(
      /content\.innerHTML\s*=\s*("(?:[^"\\]|\\.)*")\s*;/,
    )?.[1];
    if (!literal) throw new Error("popular_structure_changed");
    const doc = document(JSON.parse(literal));
    const root = DomUtils.findOne(
      (el) => el.attribs.id === "pickup_top3",
      doc.children,
    );
    if (!root) throw new Error("popular_structure_changed");
    for (const link of DomUtils.findAll(
      (el) => el.name === "a",
      root.children,
    )) {
      const heading = DomUtils.findOne(
        (el) => hasClass(el, "heading-pickup"),
        link.children,
      );
      const rank = DomUtils.findOne(
        (el) => hasClass(el, "pickup_rank"),
        link.children,
      );
      if (!heading || !rank) continue;
      const a = article(link.attribs.href || "", text(heading), sourceId, null);
      const position = Number(text(rank));
      if (!a || position !== ranks.length + 1 || position > 10)
        throw new Error("invalid_popular_article");
      articles.push(a);
      ranks.push({ id: a.id, rank: position });
    }
  }
  if (
    !articles.length ||
    new Set(articles.map((a) => a.id)).size !== articles.length
  )
    throw new Error("invalid_popular_articles");
  return dataSchema.parse({ articles, ranks, limited: false });
}
export function parseIndexMetadata(html: string, sourceId: SourceId) {
  const doc = document(html);
  const headings = DomUtils.findAll(
    (el) =>
      hasClass(
        el,
        sourceId === "hamusoku" ? "article-title" : "main_article_title",
      ),
    doc.children,
  );
  const articles: Article[] = [];
  for (const heading of headings.slice(0, 100)) {
    const link = DomUtils.findOne((el) => el.name === "a", heading.children);
    let scope: Element | null = heading;
    while (
      scope &&
      !(sourceId === "hamusoku"
        ? hasClass(scope, "article-outer")
        : scope.name === "article")
    )
      scope = scope.parent?.type === "tag" ? scope.parent : null;
    if (!link || !scope) throw new Error("archive_structure_changed");
    const time = DomUtils.findOne(
      (el) =>
        sourceId === "hamusoku"
          ? hasClass(el, "updated")
          : hasClass(el, "article_time"),
      scope.children,
    );
    const raw = time
      ? sourceId === "hamusoku"
        ? time.attribs.title || ""
        : text(time)
      : "";
    const publishedAt =
      sourceId === "hamusoku" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(raw)
        ? new Date(raw).toISOString()
        : localDate(raw);
    const a = article(
      link.attribs.href || "",
      text(link),
      sourceId,
      publishedAt,
    );
    if (!a || !a.publishedAt) throw new Error("invalid_archive_article");
    articles.push(a);
  }
  const pager = DomUtils.findAll(
    (el) =>
      /(?:^|\s)(?:pager[^\s]*|paging|pagination)(?:\s|$)/.test(
        el.attribs.class || "",
      ),
    doc.children,
  );
  const limited =
    headings.length > 100 ||
    pager.some(
      (el) =>
        DomUtils.findAll(
          (n) => n.name === "a" && /[?&]p=\d+/.test(n.attribs.href || ""),
          el.children,
        ).length > 0,
    );
  return {
    doc,
    articles: [...new Map(articles.map((a) => [a.id, a])).values()].sort(
      newest,
    ),
    limited,
  };
}
export function parseDateArchive(
  html: string,
  sourceId: SourceId,
  day: string,
): DiscoveryData {
  if (!validDay(day)) throw new Error("invalid_day");
  const parsed = parseIndexMetadata(html, sourceId);
  const title = DomUtils.findOne(
    (el) => el.name === "title",
    parsed.doc.children,
  );
  const [y, m, d] = day.split("-").map(Number);
  if (
    !title ||
    !text(title).includes(`${y}年${m}月${d}日`) ||
    parsed.articles.some((a) => japanDay(a.publishedAt!) !== day)
  )
    throw new Error("archive_structure_changed");
  return { articles: parsed.articles, ranks: [], limited: parsed.limited };
}
export async function fetchDiscovery(
  sourceId: SourceId,
  kind: Kind,
  day?: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscoveryData> {
  if (
    !sourceInfo.some((s) => s.id === sourceId) ||
    (kind !== "popular" && kind !== "date") ||
    (kind === "date" && !validDay(day || ""))
  )
    throw new Error("discovery_not_allowed");
  const url =
    kind === "popular"
      ? POPULAR[sourceId]
      : `${sourceInfo.find((s) => s.id === sourceId)!.url}archives/${day}.html`;
  const res = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
      Accept:
        kind === "popular" && sourceId === "hamusoku"
          ? "application/json"
          : "text/html, application/javascript",
    },
  });
  if (kind === "date" && res.status === 404) {
    await res.body?.cancel();
    return { articles: [], ranks: [], limited: false, unavailable: true };
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new Error("discovery_unavailable");
  }
  if (Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body.cancel();
    throw new Error("discovery_too_large");
  }
  const reader = res.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("discovery_too_large");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const input = Buffer.concat(parts).toString("utf8");
  return kind === "popular"
    ? parsePopular(input, sourceId)
    : parseDateArchive(input, sourceId, day!);
}

export class DiscoveryService {
  private pending = new Map<
    string,
    Promise<{ entry: Entry; status: "ok" | "cached" | "error" }>
  >();
  constructor(
    private cache: DiscoveryCache,
    private load = fetchDiscovery,
    private now = Date.now,
  ) {}
  private key(id: SourceId, kind: Kind, day?: string) {
    return `${id}:${kind}:${kind === "date" ? day : ""}`;
  }
  private async cached(key: string) {
    try {
      const p = entrySchema.safeParse(await this.cache.get(key));
      return p.success ? p.data : undefined;
    } catch {
      console.error("ROMNOA discovery_cache_read_failed");
      return undefined;
    }
  }
  private async source(id: SourceId, kind: Kind, day?: string) {
    const key = this.key(id, kind, day),
      pending = this.pending.get(key);
    if (pending) return pending;
    const work = (async () => {
      const old = await this.cached(key),
        now = this.now();
      const usable =
        old && now - old.fetchedAt >= -60000 && now - old.fetchedAt < MAX_AGE;
      const interval = old?.failed
        ? 60000
        : kind === "date" && day !== japanDay(now)
          ? MAX_AGE
          : 600000;
      if (
        old &&
        (usable || old.failed) &&
        now - old.checkedAt >= 0 &&
        now - old.checkedAt < interval
      )
        return {
          entry: usable
            ? old
            : { ...old, articles: [], ranks: [], fetchedAt: 0 },
          status: old.failed
            ? usable
              ? ("cached" as const)
              : ("error" as const)
            : ("ok" as const),
        };
      let entry: Entry, status: "ok" | "cached" | "error";
      try {
        const data = dataSchema.parse(await this.load(id, kind, day));
        entry = { ...data, fetchedAt: now, checkedAt: now, failed: false };
        status = "ok";
      } catch {
        console.error("ROMNOA discovery_fetch_failed", id, kind);
        entry = {
          articles: usable ? old.articles : [],
          ranks: usable ? old.ranks : [],
          limited: usable ? old.limited : false,
          unavailable: usable ? old.unavailable : false,
          fetchedAt: usable ? old.fetchedAt : 0,
          checkedAt: now,
          failed: true,
        };
        status = usable ? "cached" : "error";
      }
      try {
        await this.cache.set(key, entry);
      } catch {
        console.error("ROMNOA discovery_cache_write_failed");
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
  async get(mode: Kind, day?: string): Promise<DiscoveryResponse> {
    if (
      (mode !== "popular" && mode !== "date") ||
      (day !== undefined && !validDay(day, this.now())) ||
      (mode === "date" && !day)
    )
      throw new Error("invalid_discovery_request");
    const results = await Promise.all(
      sourceInfo.map(async (source) => {
        const [primary, archive] = await Promise.all([
          this.source(source.id, mode, day),
          mode === "popular" && day
            ? this.source(source.id, "date", day)
            : Promise.resolve(null),
        ]);
        const articles = archive
          ? primary.entry.articles.flatMap((a) => {
              const dated = archive.entry.articles.find((b) => b.id === a.id);
              return dated ? [dated] : [];
            })
          : primary.entry.articles;
        const status: "ok" | "cached" | "error" =
          primary.status === "error" || archive?.status === "error"
            ? "error"
            : primary.status === "cached" || archive?.status === "cached"
              ? "cached"
              : "ok";
        return {
          source,
          primary,
          articles,
          status,
          limited: primary.entry.limited || archive?.entry.limited,
          unavailable: primary.entry.unavailable || archive?.entry.unavailable,
        };
      }),
    );
    const articles = results.flatMap((r) => r.articles);
    return {
      mode,
      date: day || null,
      articles: mode === "date" ? articles.sort(newest) : articles,
      ranks: results
        .flatMap((r) => r.primary.entry.ranks)
        .filter((rank) => articles.some((a) => a.id === rank.id)),
      sources: results.map((r) => ({
        id: r.source.id,
        status: r.status,
        fetchedAt: r.primary.entry.fetchedAt
          ? new Date(r.primary.entry.fetchedAt).toISOString()
          : null,
      })),
      limitedSources: results.filter((r) => r.limited).map((r) => r.source.id),
      unavailableSources: results
        .filter((r) => r.unavailable)
        .map((r) => r.source.id),
      generatedAt: new Date(this.now()).toISOString(),
    };
  }
  async findKnown(
    id: string,
    collection: string,
  ): Promise<Article | undefined> {
    if (!validCollection(collection, this.now())) return;
    const target = readerArticleTarget(id);
    if (!target) return;
    const kind = collection === "popular" ? "popular" : "date";
    // Saved metadata may outlive the current screen; both lookups are cache-only.
    const keys = [
      this.key(
        target.sourceId,
        kind,
        kind === "date" ? collection.slice(5) : undefined,
      ),
    ];
    if (kind === "date") keys.push(this.key(target.sourceId, "popular"));
    for (const key of keys) {
      const entry = await this.cached(key);
      if (
        !entry ||
        this.now() - entry.fetchedAt < -60000 ||
        this.now() - entry.fetchedAt >= MAX_AGE
      )
        continue;
      const known = entry.articles.find(
        (a) => a.id === id && a.sourceId === target.sourceId,
      );
      if (known) return known;
    }
  }
}
export const discoveryService = new DiscoveryService(runtimeCache());
export async function handleDiscovery(
  request: Request,
  service: Pick<DiscoveryService, "get"> = discoveryService,
) {
  const headers = {
    "Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETのみ利用できます。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const params = new URL(request.url).searchParams,
    mode = params.get("mode"),
    day = params.get("date") ?? undefined;
  if (
    params.getAll("mode").length !== 1 ||
    params.getAll("date").length > 1 ||
    [...params.keys()].some((k) => k !== "mode" && k !== "date") ||
    (mode !== "popular" && mode !== "date") ||
    (day !== undefined && !validDay(day)) ||
    (mode === "date" && !day)
  )
    return Response.json(
      { error: "日付または表示方法が正しくありません。" },
      { status: 400, headers },
    );
  try {
    const data = await service.get(mode, day);
    return Response.json(data, {
      status: data.sources.every((s) => s.status === "error") ? 503 : 200,
      headers,
    });
  } catch {
    console.error("ROMNOA discovery_failed");
    return Response.json(
      { error: "記事を取得できませんでした。時間をおいて再試行してください。" },
      { status: 503, headers },
    );
  }
}
