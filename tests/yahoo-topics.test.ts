import { describe, expect, it } from "vitest";
import { parseYahooTopics, handleYahooTopics } from "../server/yahoo-topics";
const id = "a".repeat(40);
const xml = `<rss><channel><item><title>主要ニュース</title><link>https://news.yahoo.co.jp/pickup/123</link><comments>https://news.yahoo.co.jp/articles/${id}/comments</comments><pubDate>Sat, 31 Oct 2026 01:10:17 GMT</pubDate></item><item><title>広告</title><comments>https://example.com/articles/${id}/comments</comments></item></channel></rss>`;
describe("Yahoo topics", () => {
  it("extracts the linked Yahoo article from the topics RSS and ignores other links", () => {
    const articles = parseYahooTopics(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({
      title: "主要ニュース",
      url: `https://news.yahoo.co.jp/articles/${id}`,
      publishedAt: "2026-10-31T01:10:17.000Z",
    });
  });
  it("reports upstream failures and supports an explicit disabled mode", async () => {
    expect(
      (
        await handleYahooTopics(
          new Request("https://example.com"),
          async () => new Response("oops", { status: 503 }),
          true,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await handleYahooTopics(
          new Request("https://example.com"),
          fetch,
          false,
        )
      ).status,
    ).toBe(403);
  });
});

import { parseTopicListPage, topicsForDay, validTopicDay } from "../server/yahoo-topics";
describe("Yahoo topics of a past day", () => {
  const page = (items: { id: string; t: string; type?: string }[]) =>
    `<html><script>window.__PRELOADED_STATE__ = ${JSON.stringify({
      topicsList: {
        list: items.map((i) => ({ contentId: i.id, contentIdType: i.type ?? "shannon_article", title: `話題 ${i.id.slice(0, 3)}`, publishedTime: i.t })),
      },
    })}</script></html>`;
  const hex = (c: string) => c.repeat(40);
  it("reads only Yahoo articles with a publish time from a list page", () => {
    const got = parseTopicListPage(page([{ id: hex("a"), t: "2026-11-04T01:00:00.000Z" }, { id: hex("b"), t: "2026-11-04T01:00:00.000Z", type: "pickup_only" }, { id: "nothex", t: "2026-11-04T01:00:00.000Z" }]));
    expect(got.map((a) => a.url)).toEqual([`https://news.yahoo.co.jp/articles/${hex("a")}`]);
    expect(() => parseTopicListPage("<html></html>")).toThrow("topics_structure_changed");
  });
  it("collects one Japan-time day across pages and stops after it", async () => {
    const pages: Record<string, string> = {
      // 11/5 JST, then 11/4 JST (from 15:00Z on 11/3 to 15:00Z on 11/4), then 11/3.
      "": page([{ id: hex("1"), t: "2026-11-04T16:00:00.000Z" }, { id: hex("2"), t: "2026-11-04T14:59:00.000Z" }]),
      "?page=2": page([{ id: hex("3"), t: "2026-11-04T02:00:00.000Z" }, { id: hex("4"), t: "2026-11-03T15:00:00.000Z" }]),
      "?page=3": page([{ id: hex("5"), t: "2026-11-03T14:00:00.000Z" }]),
      "?page=4": page([{ id: hex("6"), t: "2026-11-02T14:00:00.000Z" }]),
    };
    const requested: string[] = [];
    const fetcher = (async (input: string) => {
      const q = String(input).replace("https://news.yahoo.co.jp/topics/top-picks", "");
      requested.push(q);
      return q in pages ? new Response(pages[q]) : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const got = await topicsForDay("2026-11-04", fetcher);
    expect(got.map((a) => a.url.slice(-3))).toEqual([hex("2"), hex("3"), hex("4")].map((h) => h.slice(-3)));
    expect(requested).not.toContain("?page=5");
  });
  it("offers only the last seven days", () => {
    const now = Date.parse("2026-11-05T03:00:00Z");
    expect(validTopicDay("2026-11-05", now)).toBe(true);
    expect(validTopicDay("2026-10-30", now)).toBe(true);
    expect(validTopicDay("2026-10-29", now)).toBe(false);
    expect(validTopicDay("2026-11-06", now)).toBe(false);
  });
});
