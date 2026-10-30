import { describe, expect, it } from "vitest";
import {
  classifyPhotoLink,
  rankPhotoLinks,
} from "../src/lib/photo-link-classifier";
import { parseYahooPhotoMetadata } from "../server/yahoo-photos";

describe("photo link classification", () => {
  it("recognises known gallery formats shared by several publishers", () => {
    for (const url of [
      "https://gravure.mantan-web.jp/article/20260101dog00m200001000a/photopage/001.html",
      "https://mdpr.jp/photo/detail/20639572",
      "https://bunshun.jp/articles/photo/93238",
      "https://president.jp/articles/photo/12345",
      "https://www.inside-games.jp/article/img/2026/10/28/189998/1798802.html",
      "https://www.crank-in.net/gallery/news/192811/",
      "https://thetv.jp/news/detail/999999/18550635/",
    ])
      expect(classifyPhotoLink(url).kind).toBe("gallery");
  });
  it("uses link text and photo paths as evidence for other publishers", () => {
    expect(
      classifyPhotoLink(
        "https://nlab.itmedia.co.jp/research/articles/4075832/2/",
        "【画像】無印良品の新作",
      ).kind,
    ).toBe("photo");
    expect(
      classifyPhotoLink("https://example.jp/news/1/photo/2", "記事").kind,
    ).toBe("photo");
    expect(
      classifyPhotoLink("https://example.jp/news/1", "【関連記事】別の話題")
        .kind,
    ).toBe("article");
  });
  it("never treats social posts, shops, top pages or Yahoo itself as galleries", () => {
    expect(
      classifyPhotoLink("https://x.com/user/status/1", "【写真】投稿").kind,
    ).toBe("social");
    expect(
      classifyPhotoLink("https://www.instagram.com/p/abc/", "写真").kind,
    ).toBe("social");
    for (const url of [
      "https://www.amazon.co.jp/dp/B000",
      "https://item.rakuten.co.jp/shop/1/",
      "https://news.yahoo.co.jp/articles/abc/images/000",
      "https://example.jp/",
      "https://example.jp/release.pdf",
    ])
      expect(classifyPhotoLink(url, "【画像】").kind).toBe("ignore");
  });
  it("ranks the strongest photo link first and keeps article order otherwise", () => {
    const links = [
      { title: "【関連記事】別の話題", url: "https://a.example/news/1" },
      { title: "【写真】私服ショット", url: "https://a.example/news/2" },
      { title: "写真を見る", url: "https://mdpr.jp/photo/detail/1" },
      { title: "【画像】もう一枚", url: "https://a.example/news/3" },
      { title: "投稿", url: "https://x.com/u/status/1" },
    ];
    expect(rankPhotoLinks(links).map((l) => l.url)).toEqual([
      "https://mdpr.jp/photo/detail/1",
      "https://a.example/news/2",
      "https://a.example/news/3",
    ]);
  });
  it("excludes non-photo body links from the article's photo features", () => {
    const article = `https://news.yahoo.co.jp/articles/${"c".repeat(40)}`;
    const a = (href: string, text: string) => ({
      tagName: "a",
      attributes: { href },
      children: [{ type: "text", value: text }],
    });
    const html = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({
      articleDetail: {
        contentId: "c".repeat(40),
        newsLink: article,
        richBody: [
          {
            tagName: "p",
            children: [
              a("https://x.com/u/status/1", "Xの投稿"),
              a("https://www.amazon.co.jp/dp/1", "【画像】商品"),
              a("https://pub.example/news/9", "【関連】別記事"),
              a("https://pub.example/news/8/photo/1", "【写真】本人ショット"),
            ],
          },
        ],
      },
    })};</script>`;
    expect(
      parseYahooPhotoMetadata(html, article).features.map((f) => f.url),
    ).toEqual(["https://pub.example/news/8/photo/1"]);
  });
});

describe("body link clean-up labels", () => {
  it("drops promotional and related-story calls to action", () => {
    expect(
      classifyPhotoLink("https://shop.example/item/1", "予約はこちら").kind,
    ).toBe("ignore");
    expect(
      classifyPhotoLink(
        "https://pub.example/news/2",
        "あわせて読みたい：別記事",
      ).score,
    ).toBeLessThan(0);
    expect(
      classifyPhotoLink("https://pub.example/news/3", "公式サイト").kind,
    ).toBe("article");
  });
});
