import { describe, expect, it } from "vitest";
import { parseLinkedPhotos } from "../server/linked-photo-parser";
import {
  parseYahooPhotoMetadata,
  YahooPhotoService,
  MemoryPhotoCache,
} from "../server/yahoo-photos";
import { publicAddress } from "../server/public-photo-fetch";
import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model";
const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const feature = "https://publisher.example/story.html?num=2";
const metadata = (url = feature) =>
  `<script>window.__PRELOADED_STATE__=${JSON.stringify({
    articleDetail: {
      contentId: "a".repeat(40),
      newsLink: article,
      richBody: [
        {
          tagName: "a",
          attributes: { href: url },
          children: [{ type: "text", value: "画像を見る" }],
        },
      ],
    },
  })}</script>`;
const html = `<title>Linked images</title><div id="entry-content">
<div class="content-image-main"><img src="/1.jpg" alt="one"><img data-src="/2.jpg" src="/placeholder.svg"></div>
<div class="content-image-main"><img src="/1.jpg"><img src="/2.jpg"></div>
<div class="pagenation-next"><img src="/unrelated.jpg"></div><aside><img src="/aside.jpg"></aside>
<div class="adunit"><img src="/ad.jpg"></div></div>`;
describe("publisher-independent linked photos", () => {
  it("reads ordinary inline links and canonicalizes tracking without requiring 特集 or a publisher name", () => {
    expect(
      parseYahooPhotoMetadata(
        metadata(`${feature}&utm_source=yahoo&in=news.yahoo.co.jp`),
        article,
      ).features,
    ).toEqual([{ title: "画像を見る", url: feature }]);
  });
  it("extracts and deduplicates gallery images while excluding adjacent articles and ads", () => {
    expect(parseLinkedPhotos(html, feature).pictures.map((p) => p.url)).toEqual(
      ["https://publisher.example/1.jpg", "https://publisher.example/2.jpg"],
    );
  });
  it("supports unrelated publisher markup, lazy srcset, and metadata fallback", () => {
    expect(
      parseLinkedPhotos(
        '<article><figure><img data-srcset="/small.jpg 300w, /big.jpg 1200w"></figure></article>',
        feature,
      ).picture.url,
    ).toBe("https://publisher.example/big.jpg");
    expect(
      parseLinkedPhotos(
        '<meta property="og:image" content="/cover.jpg"><nav><img src="/logo.jpg"></nav>',
        feature,
      ).picture.url,
    ).toBe("https://publisher.example/cover.jpg");
  });
  it("resolves every photo through article membership without fetching synthetic fragment pages", async () => {
    const loaded: string[] = [];
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) => {
        loaded.push(url);
        return url === article ? metadata() : html;
      },
    );
    const gallery = await service.get(article, feature);
    if (gallery.kind !== "gallery") throw Error("gallery");
    expect(gallery.pages).toHaveLength(2);
    expect(
      await service.imageSource(article, feature, gallery.pages[1], false),
    ).toEqual({ url: "https://publisher.example/2.jpg", referer: feature });
    expect(
      await service.imageSource(article, feature, gallery.pages[1], true),
    ).toEqual({ url: "https://publisher.example/2.jpg", referer: feature });
    await expect(
      service.get(article, feature, `${feature}#romnoa-photo-3`),
    ).rejects.toThrow("page_not_linked");
    await expect(
      service.get(article, "https://other.example/story"),
    ).rejects.toThrow("feature_not_linked");
    expect(loaded).toEqual([article, feature]);
  });
  it("rejects local targets, credentials and non-public socket addresses", () => {
    for (const url of [
      "http://publisher.example/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://foo.internal/x",
      "https://user:pass@publisher.example/x",
    ])
      expect(linkedPhotoTarget(url)).toBeNull();
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "100.64.0.1",
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
});
