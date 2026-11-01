import { describe, expect, it } from "vitest";
import { photoStem, siblingGallery } from "../server/sibling-gallery";
import { collectLinkedPhotos } from "../server/linked-photo-parser";
import { resolvePhotoPage } from "../server/yahoo-photos";

const cdn = "https://img.example.jp/media";
const li = (href: string, file: string, alt = "") =>
  `<li><a href="${href}"><img class="lazyload" data-src="${cdn}/${file}?impolicy=thumb_fit&amp;width=180" alt="${alt}"></a></li>`;
const natalie = (current: string, main: string) => `<html><head>
<title>ギャラリー</title><meta property="og:image" content="${cdn}/${main}"></head><body>
<main><figure><img src="${cdn}/${main}" alt="大きい写真"></figure>
<div class="NA_article_gallery"><ul class="NA_imglist">
${li("https://natalie.mu/music/gallery/news/1/101", "a_1.jpg", "1枚目")}
${li("https://natalie.mu/music/gallery/news/1/102", "b_2.jpg", "2枚目")}
${li("https://natalie.mu/music/gallery/news/1/media/7", "v_7.jpg", "動画")}
</ul></div></main>
<aside class="related"><ul>
${li("https://natalie.mu/music/gallery/news/1/999", "other.jpg")}
</ul></aside></body></html>`;

describe("sibling photo-page galleries", () => {
  it("reads a thumbnail roster that links sibling photo and media pages", () => {
    const page = "https://natalie.mu/music/gallery/news/1/102?ref=ynews&place=inline";
    const g = siblingGallery(natalie("102", "b_2.jpg"), page)!;
    expect(g.pages).toEqual([
      "https://natalie.mu/music/gallery/news/1/101",
      page,
      "https://natalie.mu/music/gallery/news/1/media/7",
    ]);
    expect(g.picture.url).toBe(`${cdn}/b_2.jpg`);
    expect(g.thumbnails[0].url).toContain("a_1.jpg");
    expect(g.truncated).toBe(false);
    const media = siblingGallery(
      natalie("7", "v_7.jpg"),
      "https://natalie.mu/music/gallery/news/1/media/7",
    )!;
    expect(media.pages).toHaveLength(3);
    expect(media.picture.url).toBe(`${cdn}/v_7.jpg`);
  });
  it("never shows a large photo that does not match the current thumbnail", () => {
    expect(
      siblingGallery(
        natalie("102", "unrelated.jpg"),
        "https://natalie.mu/music/gallery/news/1/102",
      ),
    ).toBeNull();
  });
  it("ignores related-story lists and pages outside the roster", () => {
    const html = `<html><body><main><img src="${cdn}/x.jpg"></main>
      <div class="recommend-photo"><ul>${li("https://ex.jp/photo/1", "x.jpg")}${li("https://ex.jp/photo/2", "y.jpg")}</ul></div></body></html>`;
    expect(siblingGallery(html, "https://ex.jp/photo/1")).toBeNull();
    // Other galleries of the same section, without the current page.
    const others = `<html><body><img src="${cdn}/cur.jpg"><ul class="gallery">${li("https://ex.jp/gallery/2/", "a.jpg")}${li("https://ex.jp/gallery/3/", "b.jpg")}</ul></body></html>`;
    expect(siblingGallery(others, "https://ex.jp/gallery/1/")).toBeNull();
  });
  it("supports numbered query rosters and an unlinked current thumbnail", () => {
    const html = `<html><body><div class="photo-main"><img src="${cdn}/pic2_l.jpg"></div>
      <ul class="thumbs">${li("https://ex.jp/photo/detail/?imageId=1&car=feed", "pic1_s.jpg")}<li><img src="${cdn}/pic2_s.jpg"></li>${li("https://ex.jp/photo/detail/?imageId=3", "pic3_s.jpg")}</ul></body></html>`;
    const page = "https://ex.jp/photo/detail/?imageId=2";
    const g = siblingGallery(html, page)!;
    expect(g.pages).toEqual([
      "https://ex.jp/photo/detail/?imageId=1&car=feed",
      page,
      "https://ex.jp/photo/detail/?imageId=3",
    ]);
    expect(g.picture.url).toBe(`${cdn}/pic2_l.jpg`);
  });
  it("keeps a window around the current photo for very long rosters", () => {
    const items = Array.from({ length: 120 }, (_, i) =>
      li(`https://ex.jp/a/gallery/${i + 1}/`, `img${i + 1}-300x400.jpg`),
    ).join("");
    const html = `<html><body><div class="image_box"><img src="${cdn}/img100-750x1000.jpg"></div><ul class="article_image_list">${items}</ul></body></html>`;
    const g = siblingGallery(html, "https://ex.jp/a/gallery/100/")!;
    expect(g.pages).toHaveLength(80);
    expect(g.pages).toContain("https://ex.jp/a/gallery/100/");
    expect(g.truncated).toBe(true);
  });
  it("normalises size variants when comparing photo files", () => {
    expect(photoStem(`${cdn}/abc-750x1000.jpeg`)).toBe(photoStem(`${cdn}/abc-300x400.jpg`));
    expect(photoStem(`${cdn}/abc_s.jpg`)).toBe("abc");
    expect(photoStem(`${cdn}/abc.jpg?w=200`)).toBe("abc");
  });
});

describe("gallery root followed by numbered photo pages", () => {
  const page = (n: number) => {
    const file = String(n).padStart(3, "0");
    const prev = n === 2 ? "https://ct.example.jp/gallery/E1" : n > 2 ? `https://ct.example.jp/gallery/E1/${String(n - 1).padStart(3, "0")}.jpg.html` : "";
    const next = n < 3 ? `https://ct.example.jp/gallery/E1/${String(n + 1).padStart(3, "0")}.jpg.html` : "";
    return `<html><head>${prev ? `<link rel="prev" href="${prev}">` : ""}${next ? `<link rel="next" href="${next}">` : ""}</head>
      <body><main><figure class="img-box"><img data-src="https://img.example.jp/g/${file}.jpg" alt="写真${n}"></figure></main></body></html>`;
  };
  it("collects every page of the chain in order", async () => {
    const urls: Record<string, string> = {
      "https://ct.example.jp/gallery/E1/002.jpg.html": page(2),
      "https://ct.example.jp/gallery/E1/003.jpg.html": page(3),
    };
    const g = await collectLinkedPhotos(page(1), "https://ct.example.jp/gallery/E1", async (u) => urls[u]);
    expect(g.pages).toEqual([
      "https://ct.example.jp/gallery/E1",
      "https://ct.example.jp/gallery/E1/002.jpg.html",
      "https://ct.example.jp/gallery/E1/003.jpg.html",
    ]);
    expect(g.pictures.map((p) => p.url.split("/").pop())).toEqual(["001.jpg", "002.jpg", "003.jpg"]);
    const resolved = await resolvePhotoPage(page(1), "https://ct.example.jp/gallery/E1", async (u) => urls[u]);
    expect(resolved.data.kind === "gallery" && resolved.data.complete).toBe(true);
  });
});

import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model";
describe("publisher link normalisation", () => {
  it("reads a query glued to the path with & as a query", () => {
    expect(
      linkedPhotoTarget(
        "https://newsdig.tbs.co.jp/articles/gallery/3042884&ex_position=photo&image=2&utm_source=y",
      )?.url,
    ).toBe("https://newsdig.tbs.co.jp/articles/gallery/3042884?ex_position=photo&image=2");
  });
});
