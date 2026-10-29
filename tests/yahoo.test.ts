import { describe, it, expect, vi } from "vitest";
import {
  fetchYahooFeed,
  parseYahooFeed,
  YahooService,
  MemoryYahooCache,
  handleYahoo,
} from "../server/yahoo";
import {
  filterYahoo,
  yahooArticleUrl,
  yahooImageUrl,
  yahooResponseSchema,
  type YahooCategory,
} from "../src/lib/yahoo-model";
const url = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const image =
  "https://newsatcl-pctr.c.yimg.jp/t/amd-img/20261029-test-000-1-view.jpg?w=450&h=253";
const xml = `<rss><channel><item><title><![CDATA[天気のニュース(配信社)]]></title><link>${url}?source=rss</link><pubDate>Thu, 29 Oct 2026 05:00:00 GMT</pubDate><image><![CDATA[${image}]]></image><description><![CDATA[記事冒頭 <script>悪い語</script><b>気象庁</b> の情報]]></description></item></channel></rss>`;
const a = parseYahooFeed(xml, "domestic")[0];

describe("Yahoo official RSS", () => {
  it("takes only exact news URLs and feed-provided image/summary; no full-page loading", () => {
    expect(a).toMatchObject({
      id: url,
      url,
      image,
      summary: "記事冒頭 気象庁 の情報",
      publishedAt: "2026-10-29T05:00:00.000Z",
    });
    expect(
      parseYahooFeed(
        xml.replace(`<![CDATA[${image}]]>`, image.replaceAll("&", "&amp;")),
        "domestic",
      )[0].image,
    ).toBe(image);
    expect(
      yahooResponseSchema.safeParse({
        articles: [a],
        sources: [],
        generatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
    for (const input of [
      url.replace("https:", "http:"),
      `${url}/comments`,
      `${url}?p=2`,
      `${url}#x`,
      url.replace("news.yahoo.co.jp", "news.yahoo.co.jp.evil.com"),
      url.replace("https://", "https://a@"),
      "http://127.0.0.1/",
    ])
      expect(yahooArticleUrl(input)).toBeNull();
    expect(yahooImageUrl("https://ads.yimg.jp/t/amd-img/ad.jpg")).toBeNull();
    expect(
      parseYahooFeed(
        xml.replace(image, "https://ads.example/ad.jpg"),
        "domestic",
      )[0].image,
    ).toBeNull();
    expect(() =>
      parseYahooFeed(xml.replace(url, "http://127.0.0.1/"), "domestic"),
    ).toThrow("empty_feed");
  });
  it("blocks XML declarations, invalid/empty/oversized feeds and limits 50 items", () => {
    for (const s of [
      '<!DOCTYPE rss [<!ENTITY x "x">]>' + xml,
      "<rss><",
      "<rss><channel/></rss>",
      "x".repeat(1_000_001),
    ])
      expect(() => parseYahooFeed(s, "it")).toThrow();
    const item = xml.match(/<item>[\s\S]*<\/item>/)![0];
    const bulk = `<rss><channel>${Array.from({ length: 51 }, (_, i) => item.replaceAll("a".repeat(40), i.toString(16).padStart(40, "0"))).join("")}</channel></rss>`;
    expect(parseYahooFeed(bulk, "it")).toHaveLength(50);
  });
  it("uses fixed RSS hosts, no redirects, bounded responses, no arbitrary category", async () => {
    const loader = vi.fn(async () => new Response(xml));
    expect(await fetchYahooFeed("domestic", loader)).toEqual([a]);
    expect(loader.mock.calls[0]).toMatchObject([
      "https://news.yahoo.co.jp/rss/categories/domestic.xml",
      { redirect: "error" },
    ]);
    await expect(
      fetchYahooFeed("../../evil" as YahooCategory, loader),
    ).rejects.toThrow("category_not_allowed");
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(
      fetchYahooFeed(
        "it",
        async () =>
          new Response(xml, { headers: { "content-length": "1000001" } }),
      ),
    ).rejects.toThrow("feed_too_large");
    await expect(
      fetchYahooFeed("it", async () => new Response("x".repeat(1_000_001))),
    ).rejects.toThrow("feed_too_large");
    await expect(
      fetchYahooFeed("it", async () => new Response(null, { status: 403 })),
    ).rejects.toThrow("upstream_failed");
  });
  it("merges all nine categories, de-duplicates, isolates failures and caps concurrency at three", async () => {
    let active = 0,
      peak = 0;
    const load = vi.fn(async (category: YahooCategory) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      if (category === "world") throw new Error("down");
      return [{ ...a, category }];
    });
    const service = new YahooService(new MemoryYahooCache(), load);
    const [r, r2] = await Promise.all([service.get(), service.get()]);
    expect(r).toEqual(r2);
    expect(r.articles).toHaveLength(1);
    expect(r.sources).toHaveLength(9);
    expect(r.sources.find((s) => s.id === "world")?.status).toBe("error");
    expect(peak).toBe(3);
    expect(load).toHaveBeenCalledTimes(9);
    await service.get();
    expect(load).toHaveBeenCalledTimes(9);
  });
  it("serves stale data on failure, backs off one minute, expires after 24h", async () => {
    let now = 1_000_000,
      down = false;
    const load = vi.fn(async (category: YahooCategory) => {
      if (down) throw Error("down");
      return [{ ...a, category }];
    });
    const service = new YahooService(new MemoryYahooCache(), load, () => now);
    await service.get();
    down = true;
    now += 600001;
    expect(
      (await service.get()).sources.every((s) => s.status === "cached"),
    ).toBe(true);
    await service.get();
    expect(load).toHaveBeenCalledTimes(18);
    now += 86_400_000;
    expect((await service.get()).articles).toEqual([]);
    expect(
      (await handleYahoo(new Request("https://app/api/yahoo"), service)).status,
    ).toBe(503);
  });
  it("rejects methods and all user-specified URL parameters before any fetch", async () => {
    const load = vi.fn(async () => [a]);
    const service = new YahooService(new MemoryYahooCache(), load);
    expect(
      (
        await handleYahoo(
          new Request("https://app/api/yahoo?url=https://evil"),
          service,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleYahoo(
          new Request("https://app/api/yahoo", { method: "POST" }),
          service,
        )
      ).status,
    ).toBe(405);
    expect(load).not.toHaveBeenCalled();
    const r = await handleYahoo(new Request("https://app/api/yahoo"), service);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("searches only titles or actual RSS descriptions with normalized AND terms", () => {
    const rows = [
      a,
      {
        ...a,
        id: url.replaceAll("a", "b"),
        url: url.replaceAll("a", "b"),
        category: "it" as const,
        title: "新しいPCの情報",
        summary: "別の概要",
      },
    ];
    expect(filterYahoo(rows, "気象庁", "title", "all")).toHaveLength(0);
    expect(filterYahoo(rows, "気象庁", "summary", "all")).toHaveLength(1);
    expect(filterYahoo(rows, "天気 気象庁", "summary", "all")).toHaveLength(1);
    expect(filterYahoo(rows, "天気 関連語", "summary", "all")).toHaveLength(0);
    expect(filterYahoo(rows, "ｐｃ", "title", "it")).toHaveLength(1);
    expect(filterYahoo(rows, "気象庁", "summary", "it")).toHaveLength(0);
  });
});
