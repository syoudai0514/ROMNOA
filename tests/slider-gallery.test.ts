import { describe, expect, it } from "vitest";
import { sliderGallery } from "../server/slider-gallery";
import { verticalGallery } from "../server/vertical-gallery";

const img = (n: number) => `https://img.example.jp/photos/pic${n}-600x400.jpg`;
describe("carousel galleries", () => {
  it("reads splide slides, keeps caption links and selects ?pn", () => {
    const slides = [1, 2, 3, 4]
      .map(
        (n) =>
          `<div class="splide__slide gallery-slide"><img src="${img(n)}" alt="写真${n}"><p>出典 <a href="https://commons.wikimedia.org/x">Wikimedia</a></p></div>`,
      )
      .join("");
    const html = `<html><body><div class="l-contents__inner --ad-gate"><div class="splide"><div class="splide__track"><div class="splide__list">${slides}<div class="splide__slide splide__slide--clone"><img src="${img(9)}"></div></div></div></div></div></body></html>`;
    const page = "https://pr.example.jp/articles/photo/1?pn=3";
    const g = sliderGallery(html, page)!;
    expect(g.pictures.map((p) => p.url)).toEqual([1, 2, 3, 4].map(img));
    expect(g.picture.url).toBe(img(3));
    expect(g.pages[2]).toBe(page);
    expect(g.pages[0]).toBe(`${page}#romnoa-photo-2`);
  });
  it("drops story cards appended to a swiper and ignores recommendation carousels", () => {
    const photos = [1, 2]
      .map((n) => `<div class="swiper-slide"><figure><img src="${img(n)}"><a href="#modal">拡大</a></figure></div>`)
      .join("");
    const card = `<div class="swiper-slide"><a href="https://tn.example.jp/articles/99"><img src="${img(7)}"></a></div>`;
    const html = `<html><body><section class="photolibrary"><div class="swiper-wrapper">${photos}${card}</div></section>
      <div class="recommend"><div class="swiper-wrapper">${[5, 6, 7].map((n) => `<div class="swiper-slide"><img src="${img(n)}"></div>`).join("")}</div></div></body></html>`;
    const g = sliderGallery(html, "https://tn.example.jp/photo/1")!;
    expect(g.pictures.map((p) => p.url)).toEqual([img(1), img(2)]);
    const onlyCards = `<html><body><div class="swiper-wrapper">${[1, 2].map((n) => `<div class="swiper-slide"><a href="https://tn.example.jp/articles/${n}"><img src="${img(n)}"></a></div>`).join("")}</div></body></html>`;
    expect(sliderGallery(onlyCards, "https://tn.example.jp/photo/1")).toBeNull();
  });
  it("reads Smart Slider background photos", () => {
    const slide = (n: number) =>
      `<div class="n2-ss-slide" data-title="写真${n}" data-thumbnail="//img.example.jp/t${n}.jpg"><div class="n2-ss-slide-background-image" data-desktop="//img.example.jp/full${n}.jpg"></div></div>`;
    const html = `<html><body><div class="n2-ss-slider-3">${slide(1)}${slide(2)}${slide(3)}</div></body></html>`;
    const g = sliderGallery(html, "https://bc.example.jp/images/1")!;
    expect(g.pictures.map((p) => p.url)).toEqual([1, 2, 3].map((n) => `https://img.example.jp/full${n}.jpg`));
    expect(g.thumbnails[1].url).toBe("https://img.example.jp/t2.jpg");
    expect(g.picture.alt).toBe("写真1");
  });
});

describe("vertical gallery photo pages", () => {
  const cdn = "https://cdn.example.jp/mwimgs";
  const photoPage = (index: number, total: number, file: string) => `<html><body><article><div class="vertical-gallery" id="pn${index}">
    <div class="vertical-gallery__current"><span>${index}</span>/<span>${total}</span></div>
    <figure><img src="${cdn}/1x1.gif" data-src="${cdn}/870m/${file}" data-srcset="${cdn}/870m/${file} 1x,${cdn}/1740m/${file} 2x"></figure></div>
    <div class="article-gallery__btn"><a href="/articles/-/5?page=1">もっと見る</a></div></article></body></html>`;
  const article = `<html><body><article><div class="article-body">${["photo_a1.jpg", "photo_a2.jpg", "photo_a3.jpg"].map((f) => `<figure><img src="${cdn}/870m/${f}"></figure>`).join("")}</div></article></body></html>`;
  it("completes the gallery from the article the page links to", async () => {
    const page = "https://limo.example.jp/articles/photo/5";
    const g = (await verticalGallery(photoPage(1, 3, "photo_a1.jpg"), page, async (u) => {
      expect(u).toBe("https://limo.example.jp/articles/-/5?page=1");
      return article;
    }))!;
    expect(g.pictures).toHaveLength(3);
    expect(g.picture.url).toBe(`${cdn}/1740m/photo_a1.jpg`);
    expect(g.truncated).toBe(false);
  });
  it("shows only the declared photo when the article does not contain it", async () => {
    const g = (await verticalGallery(photoPage(1, 3, "photo_zz.jpg"), "https://limo.example.jp/articles/photo/5", async () => article))!;
    expect(g.pictures).toHaveLength(1);
    expect(g.truncated).toBe(true);
  });
});
