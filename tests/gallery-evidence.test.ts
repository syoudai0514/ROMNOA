import { describe, expect, it } from "vitest";
import { parseDocument } from "htmlparser2";
import { siblingGallery } from "../server/sibling-gallery";
import { sliderGallery } from "../server/slider-gallery";
import { resolvePhotoPage } from "../server/yahoo-photos";
import { photoIdentity, photoSource } from "../server/photo-source";
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

describe("re-review regressions (ismcdn renditions, spacer GIFs, page-level classes)", () => {
  const d = "https://newsdig.ismcdn.jp/mwimgs/b/b";
  const one = (html: string) => parseDocument(html).children.flatMap(function find(n: any): any[] { return n.name === "img" ? [n] : (n.children || []).flatMap(find); })[0];
  it("treats ismcdn w / wm / m / original folders as one photograph", () => {
    for (const folder of ["1360w", "1200w", "870m", "1420wm", "-"])
      expect(photoIdentity(`${d}/${folder}/img_bb.jpg`)).toBe(photoIdentity(`${d}/680w/img_bb.jpg`));
    expect(photoIdentity(`${d}/680w/img_bb.jpg`)).not.toBe(photoIdentity(`${d}/680w/img_cc.jpg`));
  });
  it("keeps the larger ismcdn rendition from srcset", () => {
    expect(photoSource(one(`<img src="${d}/680w/img_bb.jpg" srcset="${d}/680w/img_bb.jpg 1x, ${d}/1360w/img_bb.jpg 2x">`), "https://newsdig.tbs.co.jp/")).toBe(`${d}/1360w/img_bb.jpg`);
  });
  it("matches ismcdn thumbnails to the large photo in a sibling roster", () => {
    const html = `<main><img src="${d}/680w/img_p2.jpg"><ul class="thumbs">${[1, 2, 3].map(n => `<li><a href="/gallery/9/${n}"><img src="${d}/120w/img_p${n}.jpg"></a></li>`).join("")}</ul></main>`;
    expect(siblingGallery(html, "https://ex.jp/gallery/9/2")?.pages).toHaveLength(3);
  });
  it("never returns a lazy-load placeholder GIF as the photograph", () => {
    expect(photoSource(one(`<img src="https://x.jp/common/1x1.gif" data-lazy-srcset="https://x.jp/p/a.jpg 800w">`), "https://x.jp/")).toBe("https://x.jp/p/a.jpg");
    expect(photoSource(one(`<img src="https://x.jp/common/1x1.gif" data-src="https://x.jp/p/a.jpg">`), "https://x.jp/")).toBe("https://x.jp/p/a.jpg");
    expect(photoSource(one(`<img src="https://x.jp/p/anim.gif">`), "https://x.jp/")).toBe("https://x.jp/p/anim.gif");
  });
  it("does not accept a promotion carousel because of a page-level template class", () => {
    const strip = `<div class="brand-strip"><div class="swiper-wrapper">${[10, 11, 12].map(n => `<div class="swiper-slide"><img src="${image(n)}"></div>`).join("")}</div></div>`;
    expect(sliderGallery(`<body class="single-photo-template"><div class="page-gallery-layout"><main>${strip}</main></div></body>`, "https://publisher.example.jp/articles/-/9")).toBeNull();
    // Evidence on the carousel's own wrapper still counts.
    expect(sliderGallery(`<body><main>${strip.replace("brand-strip", "article-gallery")}</main></body>`, "https://publisher.example.jp/articles/-/9")?.pictures).toHaveLength(3);
  });
});

describe("thumbnail strips", () => {
  it("never treats a carousel of navigation thumbnails as the gallery", () => {
    const strip = `<div id="photo-thumbnail"><ul class="swiper-wrapper">${[1, 2, 3].map(n => `<li class="swiper-slide"><img src="https://cdn.example.jp/mwimgs/a/b/64h/img_${n}.jpg"></li>`).join("")}</ul></div>`;
    expect(sliderGallery(`<main><div class="photo-gallery">${strip}</div></main>`, "https://publisher.example.jp/articles/photo/1?pn=2")).toBeNull();
  });
  it("uses the photo itself when a slide has no separate thumbnail", () => {
    const g = sliderGallery(`<div class="article-gallery"><div class="swiper-wrapper">${[1, 2].map(n => `<div class="swiper-slide"><img src="${image(n)}"></div>`).join("")}</div></div>`, base)!;
    expect(g.thumbnails.map(t => t.url)).toEqual([image(1), image(2)]);
  });
});

import { declaredSize, looksLikeThumbnail } from "../server/photo-source";
describe("photo size sanity", () => {
  it("reads the rendition size a URL declares", () => {
    expect(declaredSize("https://x.jp/mwimgs/7/8/64h/img_1.jpg")).toBe(64);
    expect(declaredSize("https://x.jp/mwimgs/7/8/1200wm/img_1.jpg")).toBe(1200);
    expect(declaredSize("https://x.jp/wp-content/uploads/a-150x150.jpg")).toBe(150);
    expect(declaredSize("https://x.jp/p.jpg?w=120")).toBe(120);
    expect(declaredSize("https://x.jp/p.jpg")).toBe(0);
    expect(looksLikeThumbnail("https://x.jp/p.jpg")).toBe(false);
  });
  it("rejects a gallery whose photos are all navigation thumbnails", async () => {
    const tiny = (n: number) => `https://cdn.example.jp/mwimgs/a/b/64h/img_${n}.jpg`;
    const html = `<main><div class="article-gallery"><div class="swiper-wrapper">${[1, 2, 3].map(n => `<div class="swiper-slide"><img src="${tiny(n)}"></div>`).join("")}</div></div></main>`;
    const r = await resolvePhotoPage(html, base).catch((e: Error) => e.message);
    expect(typeof r === "string" || r.strategy !== "slider").toBe(true);
    if (typeof r !== "string" && r.data.kind === "gallery")
      expect(r.data.picture.url).not.toContain("/64h/");
  });
});

import { parseLinkedPhotos } from "../server/linked-photo-parser";
describe("generic gallery: controls, WordPress originals, position", () => {
  const up = "https://www.example-shincho.com/wp-content/uploads/2026/10";
  const page = (ids: number[]) => `<head><meta property="og:image" content="${up}/1509246_1.jpg"></head><body><article><div class="p-gallery">
    <img class="p-gallery__image" src="/common/img/icon_arrow_white.png" alt="前へ"><img class="p-gallery__image" src="/common/img/icon_arrow_white.png" alt="次へ">
    ${ids.map(n => `<img class="p-gallery__image" src="${up}/1509246_${n}-345x230.jpg" alt="写真${n}">`).join("")}</div></article></body>`;
  it("skips arrow controls, uses the WordPress originals and selects ?photo=N", () => {
    const g = parseLinkedPhotos(page([1, 2, 3]), "https://www.example-shincho.jp/article/2026/1/?photo=2");
    expect(g.pictures.map(p => p.url)).toEqual([1, 2, 3].map(n => `${up}/1509246_${n}.jpg`));
    expect(g.picture.url).toBe(`${up}/1509246_2.jpg`);
    expect(g.pages[1]).toBe("https://www.example-shincho.jp/article/2026/1/?photo=2");
  });
  it("keeps the renditions when og:image is not one of their originals", () => {
    const g = parseLinkedPhotos(page([2, 3]).replace("1509246_1.jpg", "other.jpg"), "https://www.example-shincho.jp/article/2026/1/");
    expect(g.pictures[0].url).toContain("-345x230.jpg");
  });
});
