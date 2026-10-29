import { describe, it, expect, vi } from "vitest";
import {
  fetchSearch,
  parseSearchIndex,
  SearchService,
  MemorySearchCache,
  collectionFor,
  handleSearch,
} from "../server/search";
import { fetchBookmarkCounts, BookmarkMetrics } from "../server/bookmarks";
import { validCollection, shiftMonth } from "../src/lib/discovery-model";
import { filterArticles, type Article } from "../src/lib/model";
import { ReaderService, MemoryReaderCache } from "../server/reader";
import { article, readerFixture } from "./fixtures";
import {
  fetchDiscovery,
  DiscoveryService,
  MemoryDiscoveryCache,
} from "../server/discovery";

const q = "図書館";
const hamu = article(701, {
  title: "[テスト] 図書館の写真",
  publishedAt: "2020-03-01T00:00:00.000Z",
});
const alpha = article(702, {
  id: "https://alfalfalfa.com/articles/11000702.html",
  url: "https://alfalfalfa.com/articles/11000702.html",
  sourceId: "alfalfa",
  title: "[テスト] 図書館の本",
  publishedAt: "2015-03-01T00:00:00.000Z",
});
function index(source: "hamusoku" | "alfalfa", next = true) {
  const a = source === "hamusoku" ? hamu : alpha;
  return (
    `<title>図書館 を含む記事 : テスト</title>` +
    (source === "hamusoku"
      ? `<div class="article-outer"><abbr class="updated" title="2020-03-01T09:00:00+09:00"></abbr><h1 class="article-title"><a href="${a.id}">${a.title}</a></h1></div>`
      : `<article><div class="main_article_title"><a href="${a.id}?cate"><h2>${a.title}</h2></a></div><span class="article_time">2015年03月01日 09:00:00</span></article>`) +
    (next
      ? `<a href="${source === "hamusoku" ? "https://hamusoku.com" : "https://alfalfalfa.com"}/search/${encodeURIComponent(q)}?p=2">次へ</a>`
      : "")
  );
}
const metrics = async (as: Article[]) =>
  Object.fromEntries(as.map((a) => [a.id, a.sourceId === "hamusoku" ? 0 : 12]));

describe("all-period publisher search", () => {
  it("distinguishes a publisher's missing old date index from a network failure", async () => {
    const missing = await fetchDiscovery(
      "hamusoku",
      "date",
      "2010-10-20",
      async () => new Response("missing", { status: 404 }),
    );
    expect(missing).toMatchObject({ articles: [], unavailable: true });
    const d = new DiscoveryService(
      new MemoryDiscoveryCache(),
      async () => missing,
    );
    const result = await d.get("date", "2010-10-20");
    expect(result.unavailableSources).toEqual(["hamusoku", "alfalfa"]);
    expect(result.sources.map((s) => s.status)).toEqual(["ok", "ok"]);
  });
  it.each(["hamusoku", "alfalfa"] as const)(
    "parses %s's real search layout, old dates, exact cate marker and next links",
    (source) => {
      const d = parseSearchIndex(index(source), source, q, 1);
      expect(d.articles).toHaveLength(1);
      expect(d.articles[0].publishedAt).toBe(
        (source === "hamusoku" ? hamu : alpha).publishedAt,
      );
      expect(d.articles[0].url).not.toContain("?cate");
      expect(d.hasNext).toBe(true);
      expect(parseSearchIndex(index(source, false), source, q, 1).hasNext).toBe(
        false,
      );
      expect(() =>
        parseSearchIndex(index(source), source, "違う検索", 1),
      ).toThrow();
      expect(() =>
        parseSearchIndex(
          index(source).replace(
            /2020-03-01T09:00:00\+09:00|2015年03月01日 09:00:00/,
            "日時不明",
          ),
          source,
          q,
          1,
        ),
      ).toThrow();
    },
  );
  it("ignores external or query-mismatched pagination, and does not turn a URL query into a proxy", async () => {
    expect(
      parseSearchIndex(
        index("hamusoku").replace(
          "https://hamusoku.com/search/",
          "https://evil.test/search/",
        ),
        "hamusoku",
        q,
        1,
      ).hasNext,
    ).toBe(false);
    const fetcher = vi.fn(
      async () =>
        new Response(index("hamusoku"), {
          headers: { "Content-Type": "text/html" },
        }),
    );
    await fetchSearch("hamusoku", q, 1, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      `https://hamusoku.com/search/${encodeURIComponent(q)}?p=1`,
      expect.objectContaining({ redirect: "error" }),
    );
    fetcher.mockClear();
    for (const page of [0, -1, 1.5, 1001])
      await expect(fetchSearch("hamusoku", q, page, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      fetchSearch(
        "hamusoku",
        q,
        1,
        async () =>
          new Response("x", {
            headers: {
              "Content-Type": "text/html",
              "Content-Length": "2000001",
            },
          }),
      ),
    ).rejects.toThrow();
    await expect(
      fetchSearch(
        "hamusoku",
        q,
        1,
        async () =>
          new Response("x".repeat(2000001), {
            headers: { "Content-Type": "text/html" },
          }),
      ),
    ).rejects.toThrow();
    await expect(
      fetchSearch(
        "hamusoku",
        q,
        1,
        async () =>
          new Response("", {
            status: 302,
            headers: { Location: "http://127.0.0.1/" },
          }),
      ),
    ).rejects.toThrow();
  });
  it("validates request fields before any fetch, and normalizes only the search text", async () => {
    const get = vi.fn();
    for (const params of [
      "q=",
      "q=x&page=0",
      "q=x&page=01",
      "q=x&page=1.5",
      "q=x&page=1001",
      "q=x&url=http://127.0.0.1/",
      "q=x&q=y",
      "q=x&sources=unknown",
      "q=x&sources=hamusoku,hamusoku",
    ])
      expect(
        (
          await handleSearch(new Request(`https://app/api/search?${params}`), {
            get,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await handleSearch(
          new Request("https://app/api/search?q=x", { method: "POST" }),
          { get },
        )
      ).status,
    ).toBe(405);
    expect(get).not.toHaveBeenCalled();
    expect(collectionFor(" Ａ  Ｂ ", 1)).toBe(collectionFor("A B", 1));
    expect(collectionFor(q, 1)).not.toBe(collectionFor(q, 2));
    expect(validCollection(collectionFor(q, 1))).toBe(true);
    expect(validCollection("search:bad")).toBe(false);
  });
  it("coalesces source requests and supports source-specific later pages", async () => {
    const load = vi.fn(async (id: string, _q: string, page: number) => ({
      articles: page === 1 ? [id === "hamusoku" ? hamu : alpha] : [],
      hasNext: id === "hamusoku",
    }));
    const service = new SearchService(
      new MemorySearchCache(),
      load,
      Date.now,
      metrics,
    );
    const [a, b] = await Promise.all([service.get(q), service.get(q)]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(a.articles).toHaveLength(2);
    expect(b.nextSources).toEqual(["hamusoku"]);
    await service.get(q, 2, ["hamusoku"]);
    expect(load).toHaveBeenLastCalledWith("hamusoku", q, 2);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("isolates source errors, throttles retries and serves cached data only within 24 hours", async () => {
    let now = Date.parse("2026-10-28T00:00:00Z"),
      fail = false;
    const load = vi.fn(async (id: string) => {
      if (id === "alfalfa" || fail) throw new Error("down");
      return { articles: [hamu], hasNext: true };
    });
    const service = new SearchService(
      new MemorySearchCache(),
      load,
      () => now,
      metrics,
    );
    const first = await service.get(q);
    expect(first.sources.map((s) => s.status)).toEqual(["ok", "error"]);
    await service.get(q);
    expect(load).toHaveBeenCalledTimes(2);
    fail = true;
    now += 600001;
    expect((await service.get(q)).sources[0].status).toBe("cached");
    now += 86400000;
    expect((await service.get(q)).articles).toEqual([]);
    expect(
      await service.findKnown(hamu.id, collectionFor(q, 1)),
    ).toBeUndefined();
  });
  it("authorizes old search results only from the server's fresh collection, not from a supplied hash", async () => {
    const load = vi.fn(async (id: string) => ({
      articles: [id === "hamusoku" ? hamu : alpha],
      hasNext: false,
    }));
    const search = new SearchService(
      new MemorySearchCache(),
      load,
      Date.now,
      metrics,
    );
    const collection = collectionFor(q, 1);
    expect(await search.findKnown(hamu.id, collection)).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    await search.get(q);
    const reader = new ReaderService(
      new MemoryReaderCache(),
      {
        get: async () => ({
          articles: [],
          sources: [],
          generatedAt: new Date().toISOString(),
        }),
      },
      async (a) => readerFixture(a),
      Date.now,
      search,
    );
    await expect(
      reader.get(hamu.id, undefined, collection),
    ).resolves.toMatchObject({ articleId: hamu.id });
    await expect(
      reader.get(article(703).id, undefined, collection),
    ).rejects.toThrow("確認済み");
  });
  it("sorts only by measured bookmark counts, including genuine zero, with dates as a tie break", () => {
    const list = filterArticles([hamu, alpha], {
      category: "すべて",
      query: "",
      hiddenSources: [],
      ngWords: [],
      read: {},
      sort: "popular",
      popularity: { [hamu.id]: 0, [alpha.id]: 12 },
    });
    expect(list.map((a) => a.id)).toEqual([alpha.id, hamu.id]);
    expect(shiftMonth("2024-03-31", -1)).toBe("2024-02-29");
    expect(shiftMonth("2024-02-29", -12)).toBe("2023-02-28");
  });
});

describe("measured popularity", () => {
  it("uses only Hatena's fixed API, splits below its 50 URL limit and refuses missing counts", async () => {
    const items = Array.from({ length: 41 }, (_, i) => article(i + 1000));
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const u = new URL(String(input));
      expect(u.origin + u.pathname).toBe(
        "https://bookmark.hatenaapis.com/count/entries",
      );
      expect(u.searchParams.getAll("url").length).toBeLessThanOrEqual(40);
      return Response.json(
        Object.fromEntries(u.searchParams.getAll("url").map((id) => [id, 0])),
      );
    });
    const counts = await fetchBookmarkCounts(items, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(counts[items[0].id]).toBe(0);
    await expect(
      fetchBookmarkCounts([hamu], async () => Response.json({})),
    ).rejects.toThrow("incomplete");
  });
  it("caches real values and represents failure as unavailable, never invented zero", async () => {
    const loader = vi.fn(async () => {
      throw new Error("down");
    });
    const m = new BookmarkMetrics(loader);
    expect(await m.get([hamu])).toBeNull();
    expect(await m.get([hamu])).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
