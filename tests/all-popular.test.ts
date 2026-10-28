import { describe, it, expect, vi } from "vitest";
import { DiscoveryService, MemoryDiscoveryCache } from "../server/discovery";
import { fetchBookmarkCounts } from "../server/bookmarks";
import { ReaderService, MemoryReaderCache } from "../server/reader";
import { filterArticles, type Article } from "../src/lib/model";
import { compactReaderText } from "../src/lib/reader-layout";
import { validCollection } from "../src/lib/discovery-model";
import { article, readerFixture } from "./fixtures";

const now = Date.parse("2026-10-28T00:00:00Z");
const items = Array.from({ length: 70 }, (_, i) => article(1000 + i));
const extra = article(2000, { title: "[テスト] RSS外の配信元人気記事" });
const empty = { articles: [], ranks: [], limited: false };
const feed = (articles = items) => ({
  articles,
  sources: ["hamusoku", "alfalfa"].map((id) => ({
    id: id as Article["sourceId"],
    status: "ok" as const,
    fetchedAt: new Date(now).toISOString(),
  })),
  generatedAt: new Date(now).toISOString(),
});
const loader = async (id: string) =>
  id === "hamusoku"
    ? {
        articles: [items[0], extra],
        ranks: [
          { id: items[0].id, rank: 1 },
          { id: extra.id, rank: 2 },
        ],
        limited: false,
      }
    : empty;
const counts = async (articles: Article[]) =>
  Object.fromEntries(articles.map((a, i) => [a.id, i === 20 ? 12 : 0]));

describe("popularity across all acquired articles", () => {
  it("includes every feed article plus publisher candidates, deduplicates, and retains genuine zeros", async () => {
    const metrics = vi.fn(counts);
    const service = new DiscoveryService(
      new MemoryDiscoveryCache(),
      loader,
      () => now,
      { feeds: { get: async () => feed() }, metrics },
    );
    const result = await service.get("popular");
    expect(result.articles).toHaveLength(71);
    expect(result.ranks).toEqual([]);
    expect(result.rankingBasis).toBe("bookmarks");
    expect(result.collection).toMatch(/^popular:[a-f0-9]{64}$/);
    expect(validCollection(result.collection!)).toBe(true);
    expect(metrics).toHaveBeenCalledWith(result.articles);
    const sorted = filterArticles(result.articles, {
      category: "すべて",
      query: "",
      hiddenSources: [],
      ngWords: [],
      sort: "popular",
      read: {},
      popularity: result.bookmarks!,
    });
    expect(sorted).toHaveLength(71);
    expect(result.bookmarks![sorted[0].id]).toBe(12);
    expect(sorted.filter((a) => result.bookmarks![a.id] === 0)).toHaveLength(
      70,
    );
    expect(await service.findKnown(extra.id, result.collection!)).toEqual(
      extra,
    );
  });
  it("keeps all candidates when metrics fail or omit an ID, and never substitutes an invented count", async () => {
    for (const metrics of [
      async () => null,
      async () => ({}),
      async () => {
        throw new Error("down");
      },
    ]) {
      const service = new DiscoveryService(
        new MemoryDiscoveryCache(),
        loader,
        () => now,
        { feeds: { get: async () => feed() }, metrics },
      );
      const result = await service.get("popular");
      expect(result.articles).toHaveLength(71);
      expect(result.bookmarks).toBeNull();
      expect(result.sources.every((s) => s.status === "ok")).toBe(true);
    }
  });
  it("ranks every selected-date article rather than intersecting the short publisher widget", async () => {
    const feeds = { get: vi.fn(async () => feed()) };
    const load = vi.fn(async (id, kind) =>
      id === "hamusoku"
        ? { articles: items.slice(0, 20), ranks: [], limited: false }
        : empty,
    );
    const service = new DiscoveryService(
      new MemoryDiscoveryCache(),
      load,
      () => now,
      { feeds, metrics: counts },
    );
    const result = await service.get("popular", "2026-10-20");
    expect(result.articles).toHaveLength(20);
    expect(result.date).toBe("2026-10-20");
    expect(feeds.get).not.toHaveBeenCalled();
    expect(load.mock.calls.every((call) => call[1] === "date")).toBe(true);
  });
  it("isolates ranking-widget and feed failures while disclosing partial coverage", async () => {
    const widgetDown = new DiscoveryService(
      new MemoryDiscoveryCache(),
      async () => {
        throw new Error("down");
      },
      () => now,
      { feeds: { get: async () => feed() }, metrics: counts },
    );
    const all = await widgetDown.get("popular");
    expect(all.articles).toHaveLength(70);
    expect(all.partialSources).toEqual(["hamusoku", "alfalfa"]);
    const feedDown = new DiscoveryService(
      new MemoryDiscoveryCache(),
      loader,
      () => now,
      {
        feeds: {
          get: async () => {
            throw new Error("down");
          },
        },
        metrics: counts,
      },
    );
    expect((await feedDown.get("popular")).articles).toHaveLength(2);
  });
  it("authorizes the exact catalog snapshot after RSS changes, never an arbitrary hash or metadata older than 24h", async () => {
    let clock = now;
    const service = new DiscoveryService(
      new MemoryDiscoveryCache(),
      loader,
      () => clock,
      { feeds: { get: async () => feed() }, metrics: counts },
    );
    const result = await service.get("popular");
    const reader = new ReaderService(
      new MemoryReaderCache(),
      { get: async () => feed([]) },
      async (a) => readerFixture(a),
      () => clock,
      service,
    );
    await expect(
      reader.get(items[50].id, undefined, result.collection),
    ).resolves.toMatchObject({ articleId: items[50].id });
    await expect(
      reader.get(article(9999).id, undefined, result.collection),
    ).rejects.toThrow("確認済み");
    expect(
      await service.findKnown(items[51].id, `popular:${"0".repeat(64)}`),
    ).toBeUndefined();
    clock += 23 * 3600000;
    await service.get("popular");
    clock = now + 86400001;
    expect(
      await service.findKnown(items[51].id, result.collection!),
    ).toBeUndefined();
  });
  it("measures the maximum combined 220 articles using bounded official-API chunks", async () => {
    const list = Array.from({ length: 220 }, (_, i) => article(5000 + i));
    const fetcher = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://bookmark.hatenaapis.com");
      expect(url.searchParams.getAll("url").length).toBeLessThanOrEqual(40);
      return Response.json(
        Object.fromEntries(url.searchParams.getAll("url").map((id) => [id, 0])),
      );
    });
    expect(Object.keys(await fetchBookmarkCounts(list, fetcher)).length).toBe(
      220,
    );
    expect(fetcher).toHaveBeenCalledTimes(6);
    await expect(
      fetchBookmarkCounts([...list, article(6000)], fetcher),
    ).rejects.toThrow("invalid_metric");
  });
});

describe("compact reader text from fresh or cached v3 bodies", () => {
  it("removes repeated blank lines, including CRLF and whitespace-only blank lines, without losing text", () => {
    expect(compactReaderText("23\r\n\r\n  \r\n本文\n\u3000\n\n続き")).toBe(
      "23\n本文\n続き",
    );
  });
  it("retains single breaks, indentation, response numbers, URLs and literal markup as text", () => {
    const text =
      "23\n  字下げの本文\nhttps://i.imgur.com/Abc1234.jpg\n25\n<script>文字列</script>";
    expect(compactReaderText(text)).toBe(text);
  });
});
