import { describe, expect, it } from "vitest";
import { siblingGallery } from "../server/sibling-gallery";
import { sliderGallery } from "../server/slider-gallery";
import { resolvePhotoPage } from "../server/yahoo-photos";
import { photoIdentity } from "../server/photo-source";
const base = "https://publisher.example.jp/gallery/123/1";
const image = (n: number) => `https://img.example.jp/photos/photo${n}.jpg`;
const roster = (ids: number[]) => `<ul class="thumbs">${ids.map(n => `<li><a href="/gallery/123/${n}"><img src="${image(n)}"></a></li>`).join("")}</ul>`;
const track = (ids: number[], cls: string) => `<section class="${cls}"><div class="swiper-wrapper">${ids.map(n => `<div class="swiper-slide"><img src="${image(n)}"></div>`).join("")}</div></section>`;
describe("article evidence before gallery size", () => {
  it("chooses the article gallery over a larger unnamed promotion track", async () => {
    const html = `<main>${track([1,2,3], "article-gallery")}${track([10,11,12,13,14], "content-promos")}</main>`;
    const result = await resolvePhotoPage(html, base);
    expect(result.strategy).toBe("slider");
    expect(result.data.kind === "gallery" && result.data.pages).toHaveLength(3);
    expect(result.data.kind === "gallery" && result.data.picture.url).toBe(image(1));
  });
  it("prefers a track containing the declared main image", () => {
    const html = `<meta property="og:image" content="${image(1)}"><main>${track([10,11,12,13], "gallery")}${track([1,2,3], "content")}</main>`;
    expect(sliderGallery(html, base)?.picture.url).toBe(image(1));
  });
  it("tries a smaller valid roster when the largest lacks the current photo", () => {
    expect(siblingGallery(`<main><img src="${image(1)}">${roster([1,2,3])}${roster([4,5,6,7])}</main>`,base)?.pages).toHaveLength(3);
  });
  it("does not substitute an identically named photograph from another folder", () => {
    const html = `<main><img src="https://img.example.jp/advert/image001.jpg"><ul class="thumbs"><li><a href="/gallery/123/1"><img src="https://img.example.jp/article/image001.jpg"></a></li><li><a href="/gallery/123/2"><img src="https://img.example.jp/article/image002.jpg"></a></li></ul></main>`;
    expect(siblingGallery(html, base)).toBeNull();
    expect(photoIdentity("https://cdn1.example.jp/a/image001.jpg")).not.toBe(photoIdentity("https://cdn2.example.jp/a/image001.jpg"));
  });
  it("uses the largest srcset variant of the lazy photograph", () => {
    const html = `<main><img data-src="${image(1)}?w=120" srcset="${image(1)}?w=800 800w,${image(1)}?w=1600 1600w">${roster([1,2,3])}</main>`;
    expect(siblingGallery(html,base)?.picture.url).toBe(`${image(1)}?w=1600`);
  });
  it("never upgrades a photograph to an unrelated srcset image", () => {
    const html = `<main><img data-src="${image(1)}?w=120" srcset="${image(9)}?w=1600 1600w">${roster([1,2,3])}</main>`;
    expect(siblingGallery(html,base)?.picture.url).toBe(`${image(1)}?w=120`);
  });
  it("recognises nested Smart Slider wrappers as one gallery", () => {
    const html = `<div class="n2-ss-slider"><div class="n2-ss-slider-1"><div class="n2-ss-slider-2"><div class="n2-ss-slider-3"><div class="n2-ss-slide-backgrounds"></div>${[1,2,3].map(n=>`<div class="n2-ss-slide"><div data-desktop="${image(n)}"></div></div>`).join("")}</div></div></div></div>`;
    expect(sliderGallery(html, "https://publisher.example.jp/images/123")?.pictures).toHaveLength(3);
  });
  it("normalises Natalie resize queries without dropping content identifiers", () => {
    expect(photoIdentity("https://ogre.natalie.mu/media/news/photo.jpg?imwidth=1460&imdensity=1&impolicy=hq")).toBe(photoIdentity("https://ogre.natalie.mu/media/news/photo.jpg?impolicy=thumb_fit&imwidth=180"));
  });
  it("retains known resizing identities and meaningful query identifiers", () => {
    expect(photoIdentity("https://cdn.example.jp/mwimgs/870m/abc_s.jpg?w=120")).toBe(photoIdentity("https://cdn.example.jp/mwimgs/1740wm/abc_l.webp?w=1600"));
    expect(photoIdentity("https://www.inside-games.jp/imgs/p/token/123.jpg")).toBe(photoIdentity("https://www.inside-games.jp/imgs/zoom/123.jpg"));
    expect(photoIdentity("https://cdn.example.jp/image?id=1")).not.toBe(photoIdentity("https://cdn.example.jp/image?id=2"));
  });
});
