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
