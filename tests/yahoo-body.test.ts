import { describe, expect, it } from "vitest";
import {
  getYahooBody,
  handleYahooBody,
  parseYahooBody,
} from "../server/yahoo-body";
const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const html = (page: number, total = 2) =>
  `<script>window.__PRELOADED_STATE__=${JSON.stringify({ articleDetail: { contentId: "a".repeat(40), newsLink: article, currentPage: page, maxPage: total, paragraphs: [{ textDetails: [{ text: `ページ${page}\n\n本文` }, { text: "duplicate" }] }] } })}</script>`;
describe("Yahoo article body", () => {
  it("extracts each article page without duplicating textDetails and checks identity", () => {
    expect(parseYahooBody(html(1), article, 1)).toEqual({
      text: "ページ1\n\n本文",
      total: 2,
    });
    expect(() => parseYahooBody(html(1), article, 2)).toThrow(
      "article_mismatch",
    );
  });
  it("returns all pages in order and reports partial failures without skipping gaps", async () => {
    const full = await getYahooBody(article, async (_, page) =>
      parseYahooBody(html(page, 3), article, page),
    );
    expect(full.pages).toEqual([
      "ページ1\n\n本文",
      "ページ2\n\n本文",
      "ページ3\n\n本文",
    ]);
    expect(full.complete).toBe(true);
    const partial = await getYahooBody(article, async (_, page) => {
      if (page === 2) throw Error();
      return parseYahooBody(html(page, 3), article, page);
    });
    expect(partial.pages).toHaveLength(1);
    expect(partial.complete).toBe(false);
  });
  it("only accepts a single canonical Yahoo article and limits the API to preview", async () => {
    const load = async () => ({ article, pages: ["本文"], complete: true });
    expect(
      (
        await handleYahooBody(
          new Request(
            `http://localhost/?article=${encodeURIComponent(article)}&url=http://127.0.0.1`,
          ),
          load,
          true,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleYahooBody(
          new Request(
            `http://localhost/?article=${encodeURIComponent(article)}`,
          ),
          load,
          false,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleYahooBody(
          new Request(
            `http://localhost/?article=${encodeURIComponent(article)}`,
          ),
          load,
          true,
        )
      ).status,
    ).toBe(200);
  });
});
