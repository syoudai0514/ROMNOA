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
