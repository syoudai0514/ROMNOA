import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  parseLinkedPhotos,
  collectLinkedPhotos,
} from "../server/linked-photo-parser";
import {
  parseYahooPhotoMetadata,
  YahooPhotoService,
  MemoryPhotoCache,
} from "../server/yahoo-photos";
import { publicAddress } from "../server/public-photo-fetch";
import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model";
const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const feature = "https://publisher.example/story.html?num=2";
const metadata = (url = feature) =>
  `<script>window.__PRELOADED_STATE__=${JSON.stringify({
    articleDetail: {
      contentId: "a".repeat(40),
      newsLink: article,
      richBody: [
        {
          tagName: "a",
          attributes: { href: url },
          children: [{ type: "text", value: "画像を見る" }],
        },
      ],
    },
  })}</script>`;
const html = `<title>Linked images</title><div id="entry-content">
<div class="content-image-main"><img src="/1.jpg" alt="one"><img data-src="/2.jpg" src="/placeholder.svg"></div>
<div class="content-image-main"><img src="/1.jpg"><img src="/2.jpg"></div>
<div class="pagenation-next"><img src="/unrelated.jpg"></div><aside><img src="/aside.jpg"></aside>
<div class="adunit"><img src="/ad.jpg"></div></div>`;
describe("publisher-independent linked photos", () => {
  it("reads ordinary inline links and canonicalizes tracking without requiring 特集 or a publisher name", () => {
    expect(
      parseYahooPhotoMetadata(
        metadata(`${feature}&utm_source=yahoo&in=news.yahoo.co.jp`),
        article,
      ).features,
    ).toEqual([{ title: "画像を見る", url: feature }]);
  });
  it("extracts and deduplicates gallery images while excluding adjacent articles and ads", () => {
    expect(parseLinkedPhotos(html, feature).pictures.map((p) => p.url)).toEqual(
      ["https://publisher.example/1.jpg", "https://publisher.example/2.jpg"],
    );
  });
  it("supports unrelated publisher markup, lazy srcset, and metadata fallback", () => {
    expect(
      parseLinkedPhotos(
        '<article><figure><img data-srcset="/small.jpg 300w, /big.jpg 1200w"></figure></article>',
        feature,
      ).picture.url,
    ).toBe("https://publisher.example/big.jpg");
    expect(
      parseLinkedPhotos(
        '<meta property="og:image" content="/cover.jpg"><nav><img src="/logo.jpg"></nav>',
        feature,
      ).picture.url,
    ).toBe("https://publisher.example/cover.jpg");
  });
  it("ignores transparent protection overlays while keeping the photograph below", async () => {
    const page = "https://mdpr.jp/photo/detail/20639572";
    const source = `<title>写真</title><article><div class="content-image-main">
      <img class="c-imageProtect" src="https://img-mdpr.freetls.fastly.net/common/web/common/img_protect.png?quality=40" width="487" height="723">
      <img class="c-image__image" src="https://img-mdpr.freetls.fastly.net/article/C8aA/nm/actual.jpg?width=1520" width="487" height="723">
    </div></article>`;
    const parsed = parseLinkedPhotos(source, page);
    expect(parsed.pictures.map((picture) => picture.url)).toEqual([
      "https://img-mdpr.freetls.fastly.net/article/C8aA/nm/actual.jpg?width=1520",
    ]);
    const gallery = await collectLinkedPhotos(source, page, async () => {
      throw Error("unexpected fetch");
    });
    expect(gallery.pages).toEqual([page]);
    expect(gallery.picture.url).toContain("/actual.jpg");
  });
  it("resolves every photo through article membership without fetching synthetic fragment pages", async () => {
    const loaded: string[] = [];
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) => {
        loaded.push(url);
        return url === article ? metadata() : html;
      },
    );
    const gallery = await service.get(article, feature);
    if (gallery.kind !== "gallery") throw Error("gallery");
    expect(gallery.pages).toHaveLength(2);
    expect(
      await service.imageSource(article, feature, gallery.pages[1], false),
    ).toEqual({ url: "https://publisher.example/2.jpg", referer: feature });
    expect(
      await service.imageSource(article, feature, gallery.pages[1], true),
    ).toEqual({ url: "https://publisher.example/2.jpg", referer: feature });
    await expect(
      service.get(article, feature, `${feature}#romnoa-photo-3`),
    ).rejects.toThrow("page_not_linked");
    await expect(
      service.get(article, "https://other.example/story"),
    ).rejects.toThrow("feature_not_linked");
    expect(loaded).toEqual([article, feature]);
  });
  it("rejects local targets, credentials and non-public socket addresses", () => {
    for (const url of [
      "http://publisher.example/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://foo.internal/x",
      "https://user:pass@publisher.example/x",
    ])
      expect(linkedPhotoTarget(url)).toBeNull();
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "100.64.0.1",
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
});

describe("numbered HTML photo galleries", () => {
  const root = "https://www.inside-games.jp/article/img/2026/10/28/189998/";
  const feature = `${root}1798799.html`;
  const html = readFileSync(
    new URL("./fixtures/inside-gallery.html", import.meta.url),
    "utf8",
  );
  it("uses only the article roster, preserves order, and resolves full-size pages", async () => {
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) => {
        if (url === article) return metadata(feature);
        const id = url.match(/(\d+)\.html$/)?.[1];
        if (!id) throw Error("unexpected page");
        return html.replace("/imgs/zoom/1798799.jpg", `/imgs/zoom/${id}.jpg`);
      },
    );
    const initial = await service.get(article, feature);
    if (initial.kind !== "gallery") throw Error("gallery");
    expect(initial.pages).toHaveLength(10);
    expect(initial.pages[0]).toBe(`${root}1798802.html`);
    expect(initial.pages[1]).toBe(feature);
    expect(initial.picture.url).toBe(
      "https://www.inside-games.jp/imgs/zoom/1798799.jpg",
    );
    const first = await service.get(article, feature, initial.pages[0]);
    if (first.kind !== "gallery") throw Error("gallery");
    expect(first.picture.url).toBe(
      "https://www.inside-games.jp/imgs/zoom/1798802.jpg",
    );
    expect(
      await service.imageSource(article, feature, initial.pages[0], true),
    ).toEqual({
      url: "https://www.inside-games.jp/imgs/p/gvssBNQPA7w4bt5n10RlmAsJcAd_BQQDAgEA/1798802.jpg",
      referer: feature,
    });
    await expect(
      service.get(article, feature, `${root}999999.html`),
    ).rejects.toThrow("page_not_linked");
  });
  it("does not substitute another article when a listed photo is missing", async () => {
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) => {
        if (url === article) return metadata(feature);
        if (url === feature) return html;
        return html.replace("/imgs/zoom/1798799.jpg", "/imgs/zoom/other.jpg");
      },
    );
    await expect(
      service.get(article, feature, `${root}1798802.html`),
    ).rejects.toThrow("gallery_structure_changed");
  });
});

// Reported gallery: the Yahoo link opens photo 2 of 3, followed by dozens of
// unrelated cards. Each full-sized photograph lives on its own document.
describe("scoped multi-page galleries", () => {
  const base = "https://www.crank-in.net/gallery/news/192811/";
  const page = (n: number) => `${base}${n}`;
  const source = (n: number) =>
    readFileSync(
      new URL(`./fixtures/crank-gallery-${n}.html`, import.meta.url),
      "utf8",
    );
  it("uses only the primary photo region and keeps real page order, even when entering at photo 2", async () => {
    const load = vi.fn(async (url: string) =>
      source(Number(url.split("/").pop())),
    );
    const result = await collectLinkedPhotos(source(2), page(2), load);
    expect(result.pages).toEqual([page(1), page(2), page(3)]);
    expect(result.pictures).toHaveLength(3);
    expect(new Set(result.pictures.map((p) => p.url)).size).toBe(3);
    expect(JSON.stringify(result)).not.toMatch(/unrelated|another-gallery/);
    expect(result.picture.url).toBe(result.pictures[1].url);
    expect(load.mock.calls.map((c) => c[0]).sort()).toEqual([page(1), page(3)]);
  });
  it("rejects other articles, external pagers and unlisted photo pages", async () => {
    const html = source(2).replace(
      "</figure>",
      '<a href="https://evil.example/gallery/news/192811/4">next</a><a href="/gallery/news/999999/1">next</a></figure>',
    );
    expect(parseLinkedPhotos(html, page(2)).linkedPages.sort()).toEqual([
      page(1),
      page(3),
    ]);
    const engine = new YahooPhotoService(new MemoryPhotoCache(), async (url) =>
      url === article
        ? metadata(page(2))
        : source(Number(url.split("/").pop())),
    );
    const response = await engine.get(article, page(2));
    expect(response.kind === "gallery" && response.pages).toEqual([
      page(1),
      page(2),
      page(3),
    ]);
    for (const n of [1, 2, 3]) {
      const actual = await engine.imageSource(article, page(2), page(n), false);
      expect(actual).toEqual({
        url: parseLinkedPhotos(source(n), page(n)).picture.url,
        referer: page(n),
      });
    }
    await expect(engine.get(article, page(2), page(4))).rejects.toThrow(
      "page_not_linked",
    );
  });
  it("does not promote nested recommendation galleries over the primary figure", () => {
    const html =
      '<main><article><figure><img src="/correct.jpg"></figure><article><div class="gallery"><img src="/unrelated.jpg"></div></article></article></main>';
    expect(parseLinkedPhotos(html, page(2)).pictures.map((p) => p.url)).toEqual(
      ["https://www.crank-in.net/correct.jpg"],
    );
  });
  it("does not replace failed sibling pages with unrelated page images", async () => {
    await expect(
      collectLinkedPhotos(source(2), page(2), async () => {
        throw Error("failed");
      }),
    ).rejects.toThrow("failed");
  });
});

describe("gallery with a verified thumbnail roster", () => {
  const feature =
    "https://yorozoonews.jp/article/16991264?p=31481228&ro=16991264&ri=0";
  const html = readFileSync(
    new URL("./fixtures/yoro-gallery.html", import.meta.url),
    "utf8",
  );
  it("matches all 18 declared full-size photos to the article's thumbnail links", async () => {
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) => (url === article ? metadata(feature) : html),
    );
    const gallery = await service.get(article, feature);
    if (gallery.kind !== "gallery") throw Error("gallery");
    expect(gallery.pages).toHaveLength(18);
    expect(gallery.thumbnails).toHaveLength(18);
    expect(gallery.pages.indexOf(feature)).toBe(1);
    expect(new Set(gallery.pages).size).toBe(18);
    for (const p of gallery.pages) {
      const source = await service.imageSource(article, feature, p, false);
      expect(source.url).toMatch(/^https:\/\/p\.potaufeu\.asahi\.com\//);
      expect(source.url).not.toMatch(/_200px/);
    }
  });
  it("rejects an unrelated structured image that has no matching thumbnail", () => {
    const changed = html.replace(
      "8758e5a6cbb371c51fafca6548b7ea87.jpg",
      "unrelated.jpg",
    );
    expect(parseLinkedPhotos(changed, feature).pages).toHaveLength(1);
  });
});

describe("photo-page thumbnail rosters", () => {
  const base = "https://thetv.jp/news/detail/1441703/";
  const first = base + "18550634/",
    third = base + "18550635/";
  const fixture = (n: number) =>
    readFileSync(
      new URL(`./fixtures/thetv-${n}.html`, import.meta.url),
      "utf8",
    );
  it("uses the publisher's original image page instead of a 116px thumbnail", async () => {
    const engine = new YahooPhotoService(new MemoryPhotoCache(), async (url) =>
      url === article ? metadata(first) : fixture(url === third ? 3 : 2),
    );
    const gallery = await engine.get(article, first);
    if (gallery.kind !== "gallery") throw Error("gallery");
    expect(gallery.pages).toHaveLength(21);
    expect(gallery.picture.url).toContain("18550634.jpg?w=1284");
    const picture = await engine.imageSource(article, first, third, false);
    expect(picture.url).toContain("18550635.jpg?w=1284");
    expect(picture.referer).toBe(third);
    expect(
      (await engine.imageSource(article, first, third, true)).url,
    ).toContain("w=116");
    await expect(
      engine.get(
        article,
        first,
        "https://thetv.jp/news/detail/999999/18550635/",
      ),
    ).rejects.toThrow();
  });
});

it("removes Yahoo tracking fragments and extracts the linked article photo instead of related cards", () => {
  const feature = "https://nlab.itmedia.co.jp/research/articles/4075832/2/";
  expect(
    linkedPhotoTarget(feature + "#utm_source=yahoo_v3&utm_medium=feed")?.url,
  ).toBe(feature);
  const html = readFileSync(
    new URL("./fixtures/nlab-photo.html", import.meta.url),
    "utf8",
  );
  const parsed = parseLinkedPhotos(html, feature);
  expect(parsed.pictures).toHaveLength(1);
  expect(parsed.picture.url).toContain("4550723182102_org.avif");
});
