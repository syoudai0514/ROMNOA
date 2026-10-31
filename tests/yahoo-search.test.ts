import { describe, it, expect, vi } from "vitest";
import {
  parseYahooSearch,
  fetchYahooSearch,
  YahooSearchService,
  MemoryYahooSearchCache,
  handleYahooSearch,
} from "../server/yahoo-search";
import { yahooSearchResponseSchema } from "../src/lib/yahoo-model";
const q = "岡田紗佳";
const id = "a".repeat(40),
  url = `https://news.yahoo.co.jp/articles/${id}`;
const image =
  "https://newsatcl-pctr.c.yimg.jp/t/amd-img/test-view.jpg?w=192&h=192";
function item(
  n = id,
  title = `モデル・\u0002${q}\u0003さんのニュース`,
  body = "記事の検索抜粋です。",
) {
  return {
    viewType: 0,
    contentId: n,
    serviceId: "news",
    permalink: `https://news.yahoo.co.jp/articles/${n}`,
    thumbnail: { url: image },
    highlightSearchText: { headline: title, body },
    categories: [{ id: "ent" }],
    media: { name: "テスト配信社" },
    publishTime: { date: "10/29(木)", time: "7:45" },
  };
}
function html(contents = [item()], query = q, total = 243) {
  return `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ searchConditions: { query }, search: { totalResults: total, startIndex: 1, isError: false, contents }, textnewsRanking: { contents: [item("b".repeat(40), "おすすめ限定語")] }, ysaAds: [item("c".repeat(40))] }).replaceAll("<", "\\u003c")};</script>`;
}
const d = parseYahooSearch(html(), q);
describe("Yahoo publisher search beyond RSS", () => {
  it("reads only real search items, excludes ads/rankings and strips control markers without inventing dates", () => {
    const result = parseYahooSearch(
      html([
        item(),
        { ...item("d".repeat(40)), viewType: 1 },
        item("e".repeat(40), "<b>見出し</b>", "<script>悪い語</script>概要"),
      ]),
      q,
    );
    expect(result.articles).toHaveLength(2);
    expect(result.providerTotal).toBe(243);
    expect(result.articles[0]).toMatchObject({
      id: url,
      title: `モデル・${q}さんのニュース`,
      origin: "search",
      publishedAt: null,
      displayDate: "10/29(木) 7:45",
      provider: "テスト配信社",
      image,
    });
    expect(result.articles[1]).toMatchObject({
      title: "見出し",
      summary: "概要",
    });
    expect(result.articles.some((a) => /おすすめ限定語/.test(a.title))).toBe(
      false,
    );
  });
  it("rejects wrong queries, missing/error states, malformed JSON and executable suffixes", () => {
    for (const source of [
      html([], "別の語", 0),
      "<script>window.__PRELOADED_STATE__ = {}; evil()</script>",
      "<script>window.__PRELOADED_STATE__={broken}</script>",
      html().replace('"isError":false', '"isError":true'),
      "x".repeat(2_000_001),
    ])
      expect(() => parseYahooSearch(source, q)).toThrow();
    expect(parseYahooSearch(html([], q, 0), q)).toEqual({
      articles: [],
      providerTotal: 0,
    });
    expect(() => parseYahooSearch(html([], q, 2), q)).toThrow(
      "search_structure_changed",
    );
  });
  it("only accepts exact Yahoo article identifiers and image hosts", () => {
    for (const bad of [
      { ...item(), permalink: "http://127.0.0.1/" },
      { ...item(), permalink: `${url}/comments` },
      { ...item(), contentId: "b".repeat(40) },
    ])
      expect(() => parseYahooSearch(html([bad]), q)).toThrow();
    expect(
      parseYahooSearch(
        html([{ ...item(), thumbnail: { url: "https://ads.example/ad.jpg" } }]),
        q,
      ).articles[0].image,
    ).toBeNull();
  });
  it("fetches one fixed public search URL, without redirects or internal API calls, with byte bounds", async () => {
    const load = vi.fn(
      async () =>
        new Response(html(), { headers: { "content-type": "text/html" } }),
    );
    expect(await fetchYahooSearch(q, load)).toEqual(d);
    expect(load.mock.calls[0]).toMatchObject([
      `https://news.yahoo.co.jp/search?p=${encodeURIComponent(q)}`,
      { redirect: "error" },
    ]);
    await expect(fetchYahooSearch("", load)).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(1);
    await expect(
      fetchYahooSearch(
        q,
        async () =>
          new Response("x", {
            headers: {
              "content-type": "text/html",
              "content-length": "2000001",
            },
          }),
      ),
    ).rejects.toThrow("search_too_large");
    await expect(
      fetchYahooSearch(
        q,
        async () =>
          new Response("x".repeat(2_000_001), {
            headers: { "content-type": "text/html" },
          }),
      ),
    ).rejects.toThrow("search_too_large");
    await expect(
      fetchYahooSearch(q, async () => new Response("denied", { status: 403 })),
    ).rejects.toThrow("search_unavailable");
  });
  it("shares candidates between scopes and checks exact title or snippet AND matches", async () => {
    const loaded = parseYahooSearch(
      html([
        item(),
        item("b".repeat(40), "麻雀の試合", `${q}が登場しました。`),
      ]),
      q,
    );
    const load = vi.fn(async () => loaded);
    const service = new YahooSearchService(new MemoryYahooSearchCache(), load);
    const [title, summary] = await Promise.all([
      service.get(q, "title"),
      service.get(q, "summary"),
    ]);
    expect(title.articles).toHaveLength(1);
    expect(summary.articles).toHaveLength(2);
    expect(summary).toMatchObject({
      candidateCount: 2,
      providerTotal: 243,
      status: "ok",
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(yahooSearchResponseSchema.safeParse(summary).success).toBe(true);
    expect(
      (await service.get("岡田紗佳 雑誌", "summary")).articles,
    ).toHaveLength(0);
  });
  it("uses stale success on outage, backs off failures and never presents an outage as zero hits", async () => {
    let now = 1_000_000,
      down = false;
    const load = vi.fn(async () => {
      if (down) throw Error("down");
      return d;
    });
    const service = new YahooSearchService(
      new MemoryYahooSearchCache(),
      load,
      () => now,
    );
    await service.get(q, "title");
    now += 600001;
    down = true;
    expect((await service.get(q, "title")).status).toBe("cached");
    await service.get(q, "title");
    expect(load).toHaveBeenCalledTimes(2);
    now += 86_400_000;
    await expect(service.get(q, "title")).rejects.toThrow();
    const failed = new YahooSearchService(
      new MemoryYahooSearchCache(),
      async () => {
        throw Error("down");
      },
      () => now,
    );
    await expect(failed.get(q, "title")).rejects.toThrow();
    await expect(failed.get(q, "title")).rejects.toThrow();
  });
  it("validates query/method and disabled mode before loading and isolates upstream failures", async () => {
    const load = vi.fn(async () => d);
    const service = new YahooSearchService(new MemoryYahooSearchCache(), load);
    for (const tail of [
      "",
      "?q=x&url=http://127.0.0.1",
      "?q=x&q=y",
      "?q=x&scope=body",
      `?q=${"x".repeat(81)}`,
    ])
      expect(
        (
          await handleYahooSearch(
            new Request(`https://app/api/yahoo-search${tail}`),
            service,
            true,
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await handleYahooSearch(
          new Request("https://app/api/yahoo-search?q=x", { method: "POST" }),
          service,
          true,
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await handleYahooSearch(
          new Request("https://app/api/yahoo-search?q=x"),
          service,
          false,
        )
      ).status,
    ).toBe(403);
    expect(load).not.toHaveBeenCalled();
    const response = await handleYahooSearch(
      new Request(`https://app/api/yahoo-search?q=${encodeURIComponent(q)}`),
      service,
      true,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const failed = new YahooSearchService(
      new MemoryYahooSearchCache(),
      async () => {
        throw Error("down");
      },
    );
    expect(
      (
        await handleYahooSearch(
          new Request("https://app/api/yahoo-search?q=x"),
          failed,
          true,
        )
      ).status,
    ).toBe(503);
  });
});

it("loads subsequent public search pages and rejects a mismatched offset", async () => {
  const moreId = "b".repeat(40);
  const load: typeof fetch = async (input) => {
    if (String(input).includes("search-feed"))
      return new Response(
        JSON.stringify({
          totalResults: 100,
          startIndex: 51,
          contents: [item(moreId)],
        }),
        { headers: { "content-type": "application/json" } },
      );
    return new Response(html([item()], q, 100), {
      headers: { "content-type": "text/html" },
    });
  };
  const result = await fetchYahooSearch(q, load, 100);
  expect(result.articles.map((a) => a.id)).toEqual([
    url,
    `https://news.yahoo.co.jp/articles/${moreId}`,
  ]);
  const wrong: typeof fetch = async (input, init) => {
    if (String(input).includes("search-feed"))
      return new Response(
        JSON.stringify({
          totalResults: 100,
          startIndex: 1,
          contents: [item(moreId)],
        }),
        { headers: { "content-type": "application/json" } },
      );
    return load(input, init);
  };
  const partial = await fetchYahooSearch(q, wrong, 100);
  expect(partial.incomplete).toBe(true);
  expect(partial.articles).toHaveLength(1);
});

describe("large Yahoo search", () => {
  const make = (n: number) => item(n.toString(16).padStart(40, "0"));
  const first = html(Array.from({ length: 50 }, (_, i) => make(i + 1)), q, 2000);
  it("collects and validates up to 2000 candidates with bounded concurrency", async () => {
    let active = 0, peak = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      if (!u.pathname.includes("search-feed")) return new Response(first, { headers: { "content-type": "text/html" } });
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const start = Number(u.searchParams.get("start"));
      active--;
      return Response.json({ startIndex: start, totalResults: 2000, contents: Array.from({ length: 50 }, (_, i) => make(start + i)) });
    });
    const result = await fetchYahooSearch(q, fetcher, 2000);
    expect(result.articles).toHaveLength(2000);
    expect(result.incomplete).toBe(false);
    expect(peak).toBeLessThanOrEqual(10);
    expect(fetcher).toHaveBeenCalledTimes(40);
    const service = new YahooSearchService(new MemoryYahooSearchCache(), async () => result);
    const response = await service.get(q, "title", 2000);
    expect(response.candidateCount).toBe(2000);
    expect(yahooSearchResponseSchema.safeParse(response).success).toBe(true);
  });
  it("keeps successfully fetched results and reports incomplete when deeper pages fail", async () => {
    const result = await fetchYahooSearch(q, async (input) => {
      const u = new URL(String(input));
      if (!u.pathname.includes("search-feed")) return new Response(first, { headers: { "content-type": "text/html" } });
      const start = Number(u.searchParams.get("start"));
      if (start >= 1001) return new Response("unavailable", { status: 500 });
      return Response.json({ startIndex: start, totalResults: 2000, contents: Array.from({ length: 50 }, (_, i) => make(start + i)) });
    }, 2000);
    expect(result.articles).toHaveLength(1000);
    expect(result.incomplete).toBe(true);
  });
});

it("supplements a capped search using independent category windows and removes duplicates", async () => {
  const make = (n: number) => item(n.toString(16).padStart(40, "0"));
  const first = html(Array.from({ length: 50 }, (_, i) => make(i + 1)), q, 1889);
  const result = await fetchYahooSearch(q, async (input) => {
    const u = new URL(String(input));
    if (!u.pathname.includes("search-feed")) return new Response(first, { headers: { "content-type": "text/html" } });
    const start = Number(u.searchParams.get("start"));
    const category = u.searchParams.get("categories");
    if (category) {
      return Response.json({ startIndex: start, totalResults: category === "life" ? 2 : 0, contents: category === "life" ? [make(1), make(3001)] : [] });
    }
    if (start >= 1001) return new Response("unavailable", { status: 500 });
    return Response.json({ startIndex: start, totalResults: 1889, contents: Array.from({ length: 50 }, (_, i) => make(start + i)) });
  }, 2000);
  expect(result.articles).toHaveLength(1001);
  expect(result.supplemented).toBe(1);
  expect(result.incomplete).toBe(true);
  expect(result.articles.at(-1)?.id).toBe(make(3001).permalink);
});
