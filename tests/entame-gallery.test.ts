import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entameGallery } from "../server/entame-gallery";
import { YahooPhotoService, MemoryPhotoCache } from "../server/yahoo-photos";
const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const feature = "https://entamenext.com/articles/gallery/48709/1";
const second = "https://entamenext.com/articles/gallery/48709/250298";
const source = readFileSync(
  new URL("./fixtures/entame-gallery.html", import.meta.url),
  "utf8",
);
const metadata = `<script>window.__PRELOADED_STATE__=${JSON.stringify({ articleDetail: { contentId: "a".repeat(40), newsLink: article, richBody: [{ tagName: "a", attributes: { href: feature }, children: [{ type: "text", value: "写真" }] }] } })}</script>`;
const secondSource = readFileSync(
  new URL("./fixtures/entame-gallery-2.html", import.meta.url),
  "utf8",
);
describe("ENTAME next photo galleries", () => {
  it("uses the gallery roster and keeps the first page alias", () => {
    const gallery = entameGallery(source, feature)!;
    expect(gallery.pages).toEqual([
      feature,
      second,
      "https://entamenext.com/articles/gallery/48709/250299",
      "https://entamenext.com/articles/gallery/48709/250300",
    ]);
    expect(gallery.picture.url).toContain(
      "/ORG/d43b35e1905ca0f4d40716941030eb28.jpg",
    );
    expect(JSON.stringify(gallery)).not.toContain("unrelated");
  });
  it("resolves actual full images while rejecting unrelated pages and mismatches", async () => {
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) =>
        url === article ? metadata : url === feature ? source : secondSource,
    );
    const gallery = await service.get(article, feature);
    if (gallery.kind !== "gallery") throw Error("gallery");
    expect(gallery.pages).toHaveLength(4);
    const photo = await service.imageSource(article, feature, second, false);
    expect(photo.url).toContain("/ORG/55365cc2aca2101073663dc097315d0d.jpg");
    await expect(
      service.get(
        article,
        feature,
        "https://entamenext.com/articles/gallery/999/1",
      ),
    ).rejects.toThrow("page_not_linked");
  });
  it("rejects photo pages whose roster changes", async () => {
    const changed = secondSource.replaceAll(
      "eace641c65da8d8cf31b17321c034919.jpg",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
    );
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) =>
        url === article ? metadata : url === feature ? source : changed,
    );
    await expect(service.get(article, feature, second)).rejects.toThrow(
      "gallery_structure_changed",
    );
  });
});
