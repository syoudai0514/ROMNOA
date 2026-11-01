import { describe, expect, it } from "vitest";
import { realSoundGallery } from "../server/realsound-gallery";
import { YahooPhotoService, MemoryPhotoCache, resolvePhotoPage } from "../server/yahoo-photos";
const article = "https://news.yahoo.co.jp/articles/6b5327febe0a65960a3320458edd13ecf1015314";
const base = "https://realsound.jp/movie/2026/11/post-2570918.html/photo/";
const slug = (n: number) => `20261101-mimiwosumaseba-${String(n).padStart(2, "0")}`;
const page = (n: number) => base + slug(n);
const image = (n: number, thumb = false) => `https://realsound.jp/wp-content/uploads/2026/10/${slug(n)}${thumb ? "-158x85" : ""}.jpeg`;
const source = (n: number) => `<title>記事の画像一覧</title><article><figure class="attachment-img"><picture><source srcset="${image(n)}.webp"><img src="${image(n)}" alt="記事の場面"></picture><p class="attachment-caption-number">（画像 ${n} / 10 ）</p></figure><div class="attachment-list-imgs">${Array.from({ length: 10 }, (_, i) => `<div><a href="${page(i + 1)}"><picture><source srcset="${image(i + 1, true)}.webp"><img src="${image(i + 1, true)}"></picture></a></div>`).join("")}</div></article><aside class="related-entry-list"><img src="https://realsound.jp/wp-content/uploads/2026/10/unrelated.jpeg"></aside>`;
const metadata = `<script>window.__PRELOADED_STATE__=${JSON.stringify({ articleDetail: { contentId: "6b5327febe0a65960a3320458edd13ecf1015314", newsLink: article, richBody: [{ tagName: "a", attributes: { href: page(1) }, children: [{ type: "text", value: "【写真】場面カット" }] }] } })}</script>`;
describe("Real Sound attachment galleries", () => {
  it("extracts ten explicit photo links in order and their full-sized current photo", async () => {
    const result = await resolvePhotoPage(source(1), page(1));
    expect(result.strategy).toBe("realsound");
    if (result.data.kind !== "gallery") throw Error("gallery expected");
    expect(result.data.pages).toEqual(Array.from({ length: 10 }, (_, i) => page(i + 1)));
    expect(result.data.picture.url).toBe(image(1));
    expect(result.data.thumbnails[9].url).toBe(image(10, true));
    expect(JSON.stringify(result)).not.toContain("unrelated");
  });
  it("loads each article-verified page and rejects unrelated targets", async () => {
    const service = new YahooPhotoService(new MemoryPhotoCache(), async (url) => {
      if (url === article) return metadata;
      const n = Array.from({ length: 10 }, (_, i) => i + 1).find((i) => page(i) === url);
      if (!n) throw Error("unexpected source");
      return source(n);
    });
    const gallery = await service.get(article, page(1));
    if (gallery.kind !== "gallery") throw Error("gallery expected");
    expect(gallery.pages).toHaveLength(10);
    expect((await service.imageSource(article, page(1), page(10), false)).url).toBe(image(10));
    expect((await service.imageSource(article, page(1), page(10), true)).url).toBe(image(10, true));
    await expect(service.get(article, page(1), page(2).replace("2570918", "9999999"))).rejects.toThrow("page_not_linked");
  });
  it("rejects altered rosters, wrong thumbnails, and incorrect counts", () => {
    expect(() => realSoundGallery(source(1).replaceAll(image(2, true), image(3, true)), page(1))).toThrow("gallery_structure_changed");
    expect(() => realSoundGallery(source(1).replace(page(2), page(2).replace("2570918", "9999999")), page(1))).toThrow("gallery_structure_changed");
    expect(() => realSoundGallery(source(1).replace("1 / 10", "1 / 12"), page(1))).toThrow("gallery_structure_changed");
  });
});
