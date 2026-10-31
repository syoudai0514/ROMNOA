import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mdprGallery } from "../server/mdpr-gallery";
import { MemoryPhotoCache, YahooPhotoService } from "../server/yahoo-photos";

const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const feature = "https://mdpr.jp/photo/detail/20632260";
const first = "https://mdpr.jp/photo/detail/20632250";
const html = (id: string) =>
  readFileSync(new URL(`./fixtures/mdpr-${id}.html`, import.meta.url), "utf8");
const metadata = `<script>window.__PRELOADED_STATE__=${JSON.stringify({ articleDetail: { contentId: "a".repeat(40), newsLink: article, richBody: [{ tagName: "a", attributes: { href: feature }, children: [{ type: "text", value: "写真を見る" }] }] } })}</script>`;
describe("model press galleries", () => {
  it("inserts the omitted current photo in order and uses the real image", () => {
    const gallery = mdprGallery(html("20632260"), feature)!;
    expect(gallery.pages).toHaveLength(13);
    expect(gallery.pages[0]).toBe(first);
    expect(gallery.pages[2]).toBe(feature);
    expect(gallery.picture.url).toContain("/article/JDiP/");
    expect(
      gallery.thumbnails.every((t) => !t.url.includes("img_protect")),
    ).toBe(true);
    expect(mdprGallery(html("20632250"), first)?.pages).toEqual(gallery.pages);
  });
  it("checks gallery membership and resolves the full image for each page", async () => {
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) =>
        url === article
          ? metadata
          : url === feature
            ? html("20632260")
            : html("20632250"),
    );
    const gallery = await service.get(article, feature);
    if (gallery.kind !== "gallery") throw Error("gallery");
    expect(gallery.pages).toHaveLength(13);
    const image = await service.imageSource(article, feature, first, false);
    expect(image.url).toContain("/article/_Mpz/");
    expect(image.url).toContain("width=1520");
    await expect(
      service.get(article, feature, "https://mdpr.jp/photo/detail/999999"),
    ).rejects.toThrow("page_not_linked");
  });
  it("rejects a changed or unrelated gallery", async () => {
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) =>
        url === article
          ? metadata
          : url === feature
            ? html("20632260")
            : html("20632250").replaceAll(
                "/photo/detail/20632259",
                "/photo/detail/999999",
              ),
    );
    await expect(service.get(article, feature, first)).rejects.toThrow(
      "gallery_structure_changed",
    );
  });
});

it("loads the reported 53-photo roster in order and validates the first and last images", async () => {
  const source = "https://mdpr.jp/photo/detail/20609615";
  const first = "https://mdpr.jp/photo/detail/20609614";
  const last = "https://mdpr.jp/photo/detail/20609666";
  const original = mdprGallery(html("20609615"), source)!;
  expect(original.pages).toHaveLength(53);
  expect(original.pages[0]).toBe(first);
  expect(original.pages[2]).toBe(source);
  expect(original.pages[52]).toBe(last);
  expect(mdprGallery(html("20609614"), first)?.pages).toEqual(original.pages);
  expect(mdprGallery(html("20609666"), last)?.pages).toEqual(original.pages);
  const linkedMetadata = metadata.replaceAll(feature, source);
  const service = new YahooPhotoService(new MemoryPhotoCache(), async (url) => {
    if (url === article) return linkedMetadata;
    const id = new URL(url).pathname.split("/").pop();
    if (!["20609614", "20609615", "20609666"].includes(id || ""))
      throw Error("unexpected page");
    return html(id!);
  });
  const result = await service.get(article, source);
  expect(result.kind === "gallery" && result.pages.length).toBe(53);
  for (const page of [first, last]) {
    const resolved = await service.get(article, source, page);
    expect(resolved.kind === "gallery" && resolved.pageUrl).toBe(page);
    expect(
      (await service.imageSource(article, source, page, false)).url,
    ).toContain("width=1520");
  }
});
