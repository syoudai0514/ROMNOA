import { it, expect } from "vitest";
import { declaredGallery } from "../server/declared-gallery";
it("uses explicit numbered slides and ignores related cards", () => {
  const html =
    "<title>写真</title>" +
    [1, 2, 3]
      .map(
        (n) =>
          `<div class="js-article-gallery-item" data-num="${n}" data-url="https://publisher.example/gallery/1?image=${n}"><figure><img data-src="/photos/${n}.jpg"><figcaption>写真${n}</figcaption></figure><div class="related"><img src="/unrelated.jpg"></div></div>`,
      )
      .join("");
  const g = declaredGallery(
    html,
    "https://publisher.example/gallery/1?image=2",
  )!;
  expect(g.pages).toHaveLength(3);
  expect(g.picture.url).toBe("https://publisher.example/photos/2.jpg");
  expect(g.pictures.map((p) => p.url)).not.toContain(
    "https://publisher.example/unrelated.jpg",
  );
});
it("only trusts ImageGallery when its whole ordered list matches a carousel", () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      "@type": "ImageGallery",
      image: [
        { contentUrl: "https://publisher.example/1.jpg" },
        { contentUrl: "https://publisher.example/2.jpg" },
      ],
    }) +
    '</script><div class="js-carousel-slider"><img data-increment="1" src="/1.jpg"><img data-increment="2" src="/2.jpg"></div>';
  expect(
    declaredGallery(html, "https://publisher.example/gallery/1")?.pages,
  ).toHaveLength(2);
  expect(
    declaredGallery(
      html.replace('src="/2.jpg"', 'src="/other.jpg"'),
      "https://publisher.example/gallery/1",
    ),
  ).toBeNull();
});

it("reconstructs numbered figures when the current photo is rendered first", () => {
  const html = [2, 1, 3]
    .map(
      (n) =>
        `<figure class="gallery_order__item"><div class="gallery_order__numb">（${n}/3）</div><img src="/photos/${n}.jpg"></figure>`,
    )
    .join("");
  const g = declaredGallery(
    html,
    "https://publisher.example/gallery?photoid=2",
  )!;
  expect(g.pages).toHaveLength(3);
  expect(g.picture.url).toBe("https://publisher.example/photos/2.jpg");
  expect(() =>
    declaredGallery(
      html.replace("（3/3）", "（4/4）"),
      "https://publisher.example/gallery?photoid=2",
    ),
  ).toThrow("incomplete_gallery");
});
it("reads a declared JSON roster only when the rendered current photo agrees", () => {
  const items = [1, 2, 3].map((n) => ({
    imgx1: `https://cdn.example/600/${n}.jpg`,
    imgx2: `https://cdn.example/1200/${n}.jpg`,
    caption: `写真${n}`,
  }));
  const html = `<script>window.GALLERY.photos=${JSON.stringify(items)};window.GALLERY.page=2;window.GALLERY.total=3;</script><div class="js-gallery-body"><img data-gallery-src="https://cdn.example/1200/2.jpg"></div>`;
  expect(
    declaredGallery(html, "https://publisher.example/gallery?pn=2")?.pages,
  ).toHaveLength(3);
  expect(() =>
    declaredGallery(
      html.replace(
        'data-gallery-src="https://cdn.example/1200/2.jpg"',
        'data-gallery-src="https://cdn.example/1200/1.jpg"',
      ),
      "https://publisher.example/gallery?pn=2",
    ),
  ).toThrow("gallery_structure_changed");
});
