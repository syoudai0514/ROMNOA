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
    expect(parseYahooBody(html(1), article, 1)).toMatchObject({
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
    const load = async () => ({
      article,
      pages: ["本文"],
      richPages: [],
      complete: true,
    });
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

it("keeps inline links, text, article images and headings in their original order", async () => {
  const { readFileSync } = await import("node:fs");
  const fixture = readFileSync(
    new URL("./fixtures/yahoo-rich-body.html", import.meta.url),
    "utf8",
  );
  const url =
    "https://news.yahoo.co.jp/articles/d265f6978ffdeab58457f69f06aaa5813e2b3578";
  const result = parseYahooBody(fixture, url, 1);
  expect(
    result.rich.some(
      (p) => p.kind === "photo" && p.text.includes("ショート丈"),
    ),
  ).toBe(true);
  // Yahoo's own image-viewer link duplicates the article photos.
  expect(
    result.rich.some((p) => p.url?.startsWith("https://news.yahoo.co.jp/")),
  ).toBe(false);
  expect(
    result.rich.some(
      (p) =>
        p.kind === "image" &&
        p.url?.startsWith("https://newsatcl-pctr.c.yimg.jp/"),
    ),
  ).toBe(true);
  expect(
    result.rich.some((p) => p.kind === "text" && p.text.includes("購入者の声")),
  ).toBe(true);
});

it("drops shop, PR and related links, and marks SNS posts for in-app display", () => {
  const url = `https://news.yahoo.co.jp/articles/${"e".repeat(40)}`;
  const a = (href: string, value: string) => ({
    tagName: "a",
    attributes: { href },
    children: [{ type: "text", value }],
  });
  const html = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({
    articleDetail: {
      contentId: "e".repeat(40),
      newsLink: url,
      paragraphs: [{ textDetails: [{ text: "本文" }] }],
      richBody: [
        {
          tagName: "p",
          children: [
            { type: "text", value: "本文" },
            a("https://www.amazon.co.jp/dp/B0", "Amazonで購入"),
            a("https://pub.example/news/1", "【関連記事】別の話題"),
            a("https://twitter.com/user/status/1234567890", "投稿"),
            a("https://www.instagram.com/p/AbCdE12/", "投稿"),
            a("https://pub.example/official", "公式サイト"),
            a("https://www.youtube.com/watch?v=abc", "動画を見る"),
          ],
        },
      ],
    },
  })};</script>`;
  const parts = parseYahooBody(html, url, 1).rich.filter(
    (p) => p.kind !== "text",
  );
  expect(parts).toEqual([
    {
      kind: "social",
      url: "https://x.com/user/status/1234567890",
      text: "投稿",
    },
    {
      kind: "social",
      url: "https://www.instagram.com/p/AbCdE12/",
      text: "投稿",
    },
    { kind: "link", url: "https://pub.example/official", text: "公式サイト" },
    {
      kind: "link",
      url: "https://www.youtube.com/watch?v=abc",
      text: "動画を見る",
    },
  ]);
});
