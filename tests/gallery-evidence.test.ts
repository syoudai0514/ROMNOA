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

import { declaredSize, looksLikeThumbnail, thumbnailGallery, thumbnailEvidence, pageImageUrls, largestOnPage } from "../server/photo-source";
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
  const page = (ids: number[], extra = "") => `<head><meta property="og:image" content="${up}/1509246_1.jpg"></head><body><article><div class="p-gallery">
    <div class="p-gallery__nav-left"><img src="/common/img/icon_arrow_white.png" alt="前へ"></div><div class="p-gallery__nav-right"><img src="/common/img/icon_arrow_white.png" alt="次へ"></div>
    ${ids.map(n => `<div class="p-gallery__thumbnail"><img class="p-gallery__image" src="${up}/1509246_${n}-345x230.jpg" alt="写真${n}"></div>`).join("")}${extra}</div></article></body>`;
  it("skips arrow controls, keeps the thumbnail roster and selects ?photo=N", async () => {
    const r = await resolvePhotoPage(page([1, 2, 3]), "https://www.example-shincho.jp/article/2026/1/?photo=2");
    if (r.data.kind !== "gallery") throw Error("not a gallery");
    expect(r.data.pictures?.map(p => p.url.split("/").pop())).toEqual(["1509246_1.jpg", "1509246_2-345x230.jpg", "1509246_3-345x230.jpg"]);
    expect(r.data.picture.url).toBe(`${up}/1509246_2-345x230.jpg`);
    expect(r.data.pages[1]).toBe("https://www.example-shincho.jp/article/2026/1/?photo=2");
  });
  it("upgrades a photo only to a rendition the page itself names", async () => {
    const r = await resolvePhotoPage(page([1, 2], `<img hidden src="${up}/1509246_2-714x476.jpg">`), "https://www.example-shincho.jp/article/2026/1/?photo=2");
    if (r.data.kind !== "gallery") throw Error("not a gallery");
    expect(r.data.picture.url).toBe(`${up}/1509246_2-714x476.jpg`);
  });
  it("never rewrites another folder's renditions from one confirmed original", async () => {
    const html = `<head><meta property="og:image" content="${up}/a.jpg"></head><body><article><div class="entry-content">
      <img src="${up}/a-345x230.jpg"><img src="https://www.example-shincho.com/wp-content/uploads/2019/01/b-345x230.jpg"></div></article></body>`;
    const g = parseLinkedPhotos(html, "https://www.example-shincho.jp/article/2026/9/");
    expect(g.pictures.map(p => p.url)).toEqual([`${up}/a-345x230.jpg`, "https://www.example-shincho.com/wp-content/uploads/2019/01/b-345x230.jpg"]);
  });
  it("keeps body photos whose names merely contain control words", () => {
    const html = `<body><article><div class="entry-content">${["button-design", "arrow-car", "nav-system", "icon-artist"].map(n => `<figure><img src="https://www.example.jp/wp-content/uploads/2026/10/${n}.jpg" width="800" height="600"></figure>`).join("")}</div></article></body>`;
    const g = parseLinkedPhotos(html, "https://www.example.jp/article/1/");
    expect(g.pictures).toHaveLength(4);
  });
  it("drops control images that are small, UI assets or inside controls", () => {
    const html = `<body><article><div class="entry-content">
      <img src="https://www.example.jp/wp-content/uploads/2026/10/photo.jpg">
      <img src="https://www.example.jp/wp-content/uploads/2026/10/arrow-left.png" width="32" height="32">
      <img src="https://www.example.jp/assets/btn_close.png">
      <span class="slide-next"><img src="https://www.example.jp/wp-content/uploads/2026/10/arrow.png"></span>
    </div></article></body>`;
    const g = parseLinkedPhotos(html, "https://www.example.jp/article/1/");
    expect(g.pictures.map(p => p.url.split("/").pop())).toEqual(["photo.jpg"]);
  });
});

describe("second re-review: requested photo, page renditions, size evidence", () => {
  it("shows the photo-page image wrapped in a link to the next photo page (Impress Watch)", async () => {
    const page = "https://akiba-pc.watch.impress.co.jp/img/ah/docs/2152/816/html/s2.jpg.html";
    const html = `<head><meta property="og:image" content="https://akiba-pc.watch.impress.co.jp/img/ah/list/2152/816/s1.jpg"></head><body>
      <article role="main"><div id="main-image-wrap" class="resource-main" org_url="/img/ah/docs/2152/816/s2.jpg">
      <p class="image"><a href="/img/ah/docs/2152/816/html/s3.jpg.html"><img id="main-image" src="https://asset.watch.impress.co.jp/img/ah/docs/2152/816/s2.jpg"></a></p></div>
      <ul class="pager"><li class="next"><a href="/img/ah/docs/2152/816/html/s3.jpg.html">次の画像</a></li></ul></article></body>`;
    const r = await resolvePhotoPage(html, page);
    expect(r.data.kind === "gallery" && r.data.picture.url).toBe("https://asset.watch.impress.co.jp/img/ah/docs/2152/816/s2.jpg");
  });
  it("uses <picture> large renditions and opens a photo page on its og:image (西日本新聞)", async () => {
    const page = "https://www.nishinippon.co.jp/image/1095258/";
    const slide = (id: number) => `<div class="swiper-slide"><figure><picture><source media="(min-width: 768px)" srcSet="/uploads/image/${id}/large_P${id}.jpg" width="670" height="648"/><img src="/uploads/image/${id}/middle_P${id}.jpg" width="670" height="648"/></picture></figure></div>`;
    const html = `<head><meta property="og:image" content="https://www.nishinippon.co.jp/uploads/image/1951360/sns_P1951360.jpg"></head><body><main><div class="photo-gallery"><div class="swiper-wrapper">${[1951838, 1951837, 1951360].map(slide).join("")}</div></div></main></body>`;
    const r = await resolvePhotoPage(html, page);
    if (r.data.kind !== "gallery") throw Error("not a gallery");
    expect(r.data.picture.url).toBe("https://www.nishinippon.co.jp/uploads/image/1951360/large_P1951360.jpg");
    expect(r.data.pages[2]).toBe(page);
  });
  it("prefers the big rendition the page links for a numbered photo (みんなの経済新聞)", () => {
    const urls = pageImageUrls(`<meta property="og:image" content="https://images.keizai.biz/k/photonews/1793707097_b.jpg"><img src="https://images.keizai.biz/k/photonews/1793707097.jpg">`, "https://k.keizai.biz/photoflash/1/");
    expect(largestOnPage("https://images.keizai.biz/k/photonews/1793707097.jpg", urls)).toBe("https://images.keizai.biz/k/photonews/1793707097_b.jpg");
    // A different photo with the same stem in another media folder is not used.
    expect(photoIdentity("https://x.jp/uploads/image/1951360/large_a.jpg")).not.toBe(photoIdentity("https://x.jp/uploads/image/1951361/large_a.jpg"));
  });
  it("counts unknown sizes as unknown, not as photographs", () => {
    const tiny = (n: number) => `https://cdn.example.jp/mwimgs/a/b/64h/img_${n}.jpg`;
    expect(thumbnailGallery(tiny(1), [tiny(1), tiny(2), "https://cdn.example.jp/unknown.jpg"])).toBe(true);
    expect(thumbnailGallery("https://cdn.example.jp/big.jpg?w=1200", ["https://cdn.example.jp/big.jpg?w=1200", "https://cdn.example.jp/a.jpg"])).toBe(false);
    // A height alone is not the long side: 400hm is not a thumbnail.
    expect(thumbnailEvidence("https://x.jp/mwimgs/7/8/400hm/img_1.jpg")).toBeNull();
    expect(thumbnailEvidence("https://x.jp/mwimgs/7/8/64h/img_1.jpg")).toBe(true);
    expect(thumbnailEvidence("https://x.jp/p.jpg?h=200")).toBeNull();
  });
});
