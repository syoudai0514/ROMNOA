import { describe, it, expect, vi } from "vitest";
import {
  japanDay,
  validDay,
  validCollection,
} from "../src/lib/discovery-model";
import { filterArticles } from "../src/lib/model";
import {
  DiscoveryService,
  MemoryDiscoveryCache,
  parsePopular,
  parseDateArchive,
  fetchDiscovery,
  handleDiscovery,
} from "../server/discovery";
import {
  ReaderService,
  MemoryReaderCache,
  handleReader,
} from "../server/reader";
import { article, readerFixture } from "./fixtures";

const day = "2026-10-20";
const dated = article(91, { publishedAt: "2026-10-19T15:00:00.000Z" });
const alpha = article(92, {
  id: "https://alfalfalfa.com/articles/11000092.html",
  url: "https://alfalfalfa.com/articles/11000092.html",
  sourceId: "alfalfa",
  publishedAt: dated.publishedAt,
});
const archive = (source: "hamusoku" | "alfalfa", date = day) => {
  const title = `<title>${date.replace(/-(\d{2})-(\d{2})$/, (_, m, d) => `年${+m}月${+d}日`)}</title>`;
  return (
    title +
    (source === "hamusoku"
      ? `<div class="article-outer"><abbr class="updated" title="${date}T00:00:00+09:00"></abbr><div class="article-header"><h1 class="article-title"><a href="${dated.id}">テストの公開記事</a></h1></div></div>`
      : `<article><div class="main_article_title"><a href="${alpha.id}"><h2>テストの公開記事</h2></a></div><span class="article_time">${date.replace(/-(\d{2})-(\d{2})$/, (_, m, d) => `年${+m}月${+d}日`)} 00:00:00</span></article>`)
  );
};
const data = (a = dated) => ({
  articles: [a],
  ranks: [{ id: a.id, rank: 1 }],
  limited: false,
});

describe("publisher rankings and date archives", () => {
  it("uses Japan's calendar boundaries, rejects invalid/overflow/future dates", () => {
    expect(japanDay("2026-10-19T14:59:59Z")).toBe("2026-10-19");
    expect(japanDay("2026-10-19T15:00:00Z")).toBe(day);
    expect(validDay("2024-02-29")).toBe(true);
    for (const date of [
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-1-01",
      "2004-12-31",
      "9999-12-31",
      "../../private",
    ])
      expect(validDay(date)).toBe(false);
    expect(validCollection("date:2026-10-20")).toBe(true);
    expect(validCollection("https://evil.test/")).toBe(false);
  });
  it.each(["hamusoku", "alfalfa"] as const)(
    "extracts only %s archive headings and actual published dates",
    (source) => {
      const d = parseDateArchive(
        archive(source) + `<aside><a href="https://evil.test">広告</a></aside>`,
        source,
        day,
      );
      expect(d.articles).toHaveLength(1);
      expect(d.articles[0].publishedAt).toBe("2026-10-19T15:00:00.000Z");
      expect(d.articles[0].sourceId).toBe(source);
      expect(d.articles[0].title).toBe("テストの公開記事");
      expect(() =>
        parseDateArchive(archive(source), source, "2026-10-21"),
      ).toThrow();
      expect(() =>
        parseDateArchive(
          archive(source).replace(/T00:00:00\+09:00|00:00:00/, "99:00:00"),
          source,
          day,
        ),
      ).toThrow();
      expect(
        parseDateArchive(`<title>2026年10月20日</title>`, source, day).articles,
      ).toEqual([]);
    },
  );
  it("decodes a JSON string literal, keeps source rank, rejects rank gaps and never executes scripts", () => {
    const html = `<div id="pickup_top3"><a href="${alpha.id}"><span class="pickup_rank">1</span><h3 class="heading-pickup">テストの人気記事</h3></a></div>`;
    const js = `content.innerHTML=${JSON.stringify(html)};throw new Error('must not execute');`;
    expect(parsePopular(js, "alfalfa").ranks).toEqual([
      { id: alpha.id, rank: 1 },
    ]);
    expect(() => parsePopular(js.replace(">1<", ">3<"), "alfalfa")).toThrow();
    expect(() => parsePopular("content.innerHTML=evil()", "alfalfa")).toThrow();
    expect(() =>
      parsePopular(
        `content.innerHTML=${JSON.stringify(html.replace(alpha.id, "https://evil.test/articles/12345678.html"))};`,
        "alfalfa",
      ),
    ).toThrow();
    const hamu = JSON.stringify({
      articles: [
        {
          url: dated.url,
          title: "テストの人気記事",
          created_at_ymdhm: "2026-10-20 00:00",
        },
      ],
    });
    const parsed = parsePopular(hamu, "hamusoku");
    expect(parsed.articles[0].publishedAt).toBe(dated.publishedAt);
    expect(parsed.ranks[0].rank).toBe(1);
  });
  it("pins fetch destinations, blocks arbitrary dates, redirects, and oversized responses", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(archive("hamusoku"), {
          headers: { "Content-Type": "text/html" },
        }),
    );
    await fetchDiscovery("hamusoku", "date", day, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://hamusoku.com/archives/2026-10-20.html",
      expect.objectContaining({ redirect: "error" }),
    );
    fetcher.mockClear();
    await expect(
      fetchDiscovery("hamusoku", "date", "../../private", fetcher),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      fetchDiscovery(
        "hamusoku",
        "date",
        day,
        async () =>
          new Response("", {
            status: 302,
            headers: { Location: "http://127.0.0.1/" },
          }),
      ),
    ).rejects.toThrow();
    await expect(
      fetchDiscovery(
        "hamusoku",
        "date",
        day,
        async () =>
          new Response("large", { headers: { "Content-Length": "2000001" } }),
      ),
    ).rejects.toThrow();
    await expect(
      fetchDiscovery(
        "hamusoku",
        "date",
        day,
        async () => new Response("a".repeat(2000001)),
      ),
    ).rejects.toThrow();
  });
  it("coalesces fetches and isolates source failures, including negative-cache backoff", async () => {
    const load = vi.fn(async (id: string) => {
      if (id === "alfalfa") throw new Error("unavailable");
      return data();
    });
    const service = new DiscoveryService(new MemoryDiscoveryCache(), load);
    const [a, b] = await Promise.all([
      service.get("popular"),
      service.get("popular"),
    ]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(a.sources.map((s) => s.status)).toEqual(["ok", "error"]);
    expect(b.articles).toHaveLength(1);
    await service.get("popular");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("uses a stale ranking after failure, labels it cached, and expires authorization", async () => {
    let now = Date.parse("2026-10-21T00:00:00Z"),
      fail = false;
    const load = vi.fn(async (id: string) => {
      if (fail) throw new Error("offline");
      return data(id === "hamusoku" ? dated : alpha);
    });
    const service = new DiscoveryService(
      new MemoryDiscoveryCache(),
      load,
      () => now,
    );
    await service.get("popular");
    fail = true;
    now += 600001;
    const stale = await service.get("popular");
    expect(stale.sources.map((s) => s.status)).toEqual(["cached", "cached"]);
    expect(await service.findKnown(dated.id, "popular")).toEqual(dated);
    now = Date.parse("2026-10-21T00:00:00Z") + 86400000 - 5000;
    await service.get("popular");
    now += 10000;
    expect(await service.findKnown(dated.id, "popular")).toBeUndefined();
    expect((await service.get("popular")).articles).toEqual([]);
    expect(load).toHaveBeenCalledTimes(6);
  });
  it("intersects current popularity with real date metadata without inventing past ranks", async () => {
    const other = article(93, { publishedAt: "2026-10-20T03:00:00Z" });
    const load = vi.fn(async (id: string, kind: string) =>
      id === "alfalfa"
        ? { articles: [], ranks: [], limited: false }
        : kind === "popular"
          ? {
              articles: [other, dated],
              ranks: [
                { id: other.id, rank: 1 },
                { id: dated.id, rank: 2 },
              ],
              limited: false,
            }
          : data(),
    );
    const service = new DiscoveryService(new MemoryDiscoveryCache(), load);
    const filtered = await service.get("popular", day);
    expect(filtered.articles.map((a) => a.id)).toEqual([dated.id]);
    expect(filtered.ranks).toEqual([{ id: dated.id, rank: 2 }]);
    await service.get("date", day);
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("keeps source rankings separate, preserves gaps after NG filtering, and excludes unranked articles", () => {
    const second = article(2),
      unranked = article(3);
    const result = filterArticles([alpha, second, dated, unranked], {
      category: "すべて",
      query: "",
      hiddenSources: [],
      ngWords: [dated.title],
      read: {},
      sort: "popular",
      ranks: { [dated.id]: 1, [second.id]: 3, [alpha.id]: 1 },
    });
    expect(result.map((a) => a.id)).toEqual([second.id, alpha.id]);
  });
  it("rejects malformed API queries before any upstream work", async () => {
    const get = vi.fn();
    for (const q of [
      "mode=date",
      "mode=date&date=2026-02-30",
      "mode=popular&url=http://127.0.0.1",
      "mode=popular&mode=date",
      "mode=date&date=2026-10-20&date=2026-10-21",
      "mode=unknown",
    ])
      expect(
        (
          await handleDiscovery(new Request(`https://app/api/discovery?${q}`), {
            get,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await handleDiscovery(
          new Request("https://app/api/discovery?mode=popular", {
            method: "POST",
          }),
          { get },
        )
      ).status,
    ).toBe(405);
    expect(get).not.toHaveBeenCalled();
  });
  it("authorizes date/ranking articles only from fresh server caches, never by a client date alone", async () => {
    const load = vi.fn(async (id: string) =>
      data(id === "hamusoku" ? dated : alpha),
    );
    const discovery = new DiscoveryService(new MemoryDiscoveryCache(), load);
    expect(await discovery.findKnown(dated.id, `date:${day}`)).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    await discovery.get("date", day);
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
      discovery,
    );
    await expect(
      reader.get(dated.id, undefined, `date:${day}`),
    ).resolves.toMatchObject({ articleId: dated.id });
    await expect(
      reader.get(article(99).id, undefined, `date:${day}`),
    ).rejects.toThrow("確認済み");
    const get = vi.fn();
    expect(
      (
        await handleReader(
          new Request(
            `https://app/api/reader?article=${encodeURIComponent(dated.id)}&collection=date:2026-02-30`,
          ),
          { get },
        )
      ).status,
    ).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
});
