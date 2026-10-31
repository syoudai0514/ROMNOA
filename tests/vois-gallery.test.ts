import { describe, expect, it } from "vitest";
import { voisGallery } from "../server/vois-gallery";
import { YahooPhotoService, MemoryPhotoCache } from "../server/yahoo-photos";
const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const base = "https://voisjp.me/news/319398/";
const slug = (n: number) => `pen20260928-080245-${String(n).padStart(3, "0")}`;
const page = (n: number) => `${base}${slug(n)}/`;
const image = (n: number, thumb = false) => `https://voisjp.me/wp-content/uploads/2026/09/${slug(n)}${thumb ? "-180x101" : ""}.jpg`;
const html = (n: number) => `<title>写真 ${n}/6</title><article><h1 class="photo-title">【写真】記事タイトル (${n}/6)</h1><div class="photo-content"><figure><img src="${image(n)}"><figcaption>写真の説明</figcaption></figure></div><div class="siblings-grid">${[1, 2, 3, 4, 5, 6].filter((i) => i !== n).map((i) => `<a href="${page(i)}" class="sibling-item"><img src="${image(i, true)}"></a>`).join("")}</div><div class="recommend"><a href="${base}unrelated/"><img src="https://example.org/ad.jpg"></a></div></article>`;
const metadata = `<script>window.__PRELOADED_STATE__=${JSON.stringify({ articleDetail: { contentId: "a".repeat(40), newsLink: article, richBody: [{ tagName: "a", attributes: { href: page(5) }, children: [{ type: "text", value: "【写真】記事の写真" }] }] } })}</script>`;
describe("vois attachment gallery", () => {
  it("reconstructs the six-image order when the current fifth photo is omitted from the sibling roster", () => {
    const result = voisGallery(html(5), page(5))!;
    expect(result.pages).toEqual([1, 2, 3, 4, 5, 6].map(page));
    expect(result.picture).toMatchObject({ url: image(5), caption: "写真の説明" });
    expect(result.thumbnails[1].url).toBe(image(2, true));
    expect(JSON.stringify(result)).not.toContain("unrelated");
    expect(voisGallery(html(2), page(2))?.pages).toEqual(result.pages);
  });
  it("serves the full image from a linked page and refuses unrelated pages", async () => {
    const service = new YahooPhotoService(new MemoryPhotoCache(), async (url) => {
      if (url === article) return metadata;
      const n = [1, 2, 3, 4, 5, 6].find((i) => page(i) === url);
      if (!n) throw Error("unexpected source");
      return html(n);
    });
    const gallery = await service.get(article, page(5));
    if (gallery.kind !== "gallery") throw Error("gallery");
    expect(gallery.pages).toHaveLength(6);
    expect((await service.imageSource(article, page(5), page(2), false)).url).toBe(image(2));
    expect((await service.imageSource(article, page(5), page(2), true)).url).toBe(image(2, true));
    await expect(service.get(article, page(5), "https://voisjp.me/news/999/unrelated/")).rejects.toThrow("page_not_linked");
  });
  it("rejects mismatched thumbnails, different articles and incomplete lists", () => {
    expect(() => voisGallery(html(5).replace(image(2, true), image(3, true)), page(5))).toThrow("gallery_structure_changed");
    expect(() => voisGallery(html(5).replace(page(2), page(2).replace("319398", "999")), page(5))).toThrow("gallery_structure_changed");
    expect(() => voisGallery(html(5).replace("(5/6)", "(5/8)"), page(5))).toThrow("gallery_structure_changed");
  });
});
