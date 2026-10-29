import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  photoFeatureTarget,
  mantanPhotoUrl,
} from "../src/lib/yahoo-photos-model";
import {
  parseYahooPhotoMetadata,
  parseMantanPhotoPage,
  fetchPhotoHtml,
  YahooPhotoService,
  MemoryPhotoCache,
  handleYahooPhotos,
} from "../server/yahoo-photos";
const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const family = "20260101dog00m200001000a";
const other = "20260102dog00m200002000a";
const page = (n = 1, f = family) =>
  `https://gravure.mantan-web.jp/article/${f}/photopage/${String(n).padStart(3, "0")}.html`;
const img = (n = 1, width = 1106, f = family) =>
  `https://storage.mantan-web.jp/w=${width},f=webp:auto/images/2026/01/01/${f}/${String(n).padStart(3, "0")}.jpg`;
const cover =
  "https://newsatcl-pctr.c.yimg.jp/t/amd-img/test-view.jpg?exp=10800";
function metadata(id = article) {
  return `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({
    articleDetail: {
      contentId: id.split("/").pop(),
      newsLink: id,
      richObjectItems: [
        {
          view: { uri: cover },
          thumb: { uri: `${cover}&w=192&h=192` },
          alt: "記事の写真",
          caption: "写真説明",
          credit: "配信社",
        },
      ],
      paragraphs: [
        {
          textDetails: [
            {
              text: "本文全文限定語",
              link: {
                linkText: "【写真特集】記事に紐づく写真",
                linkURL: `${page()}?ext_m=y`,
              },
            },
          ],
        },
      ],
      relatedLink: [
        { title: "関連する写真特集", uri: `${page(1, other)}?ext_m=y` },
        { title: "広告", uri: "https://ads.example/redirect" },
      ],
    },
    textnewsRanking: [{ linkURL: page(9) }],
  })};</script>`;
}
function gallery(n = 1, f = family) {
  return `<title>写真特集 ${n}/3</title><div class="advertisement"><div class="photo__photo--minh"><img class="photo__image" src="${img(9, 4000, f)}"></div></div><div class="photo__photo--minh"><img class="photo__image" alt="本文の写真${n}" src="${img(n, 680, f)}" srcset="${img(n, 680, f)} 1x, ${img(n, 1106, f)} 1.63x"></div><div class="photo-list">${[1, 2, 3].map((i) => `<a class="photo__photolist-item" href="${page(i, f)}"><img src="${img(i, 240, f)}"></a>`).join("")}</div><aside><a class="photo__photolist-item" href="${page(9, f)}"><img src="${img(9, 240, f)}"></a></aside><img class="matome-related__photo" src="${img(1, 2000, other)}">`;
}
describe("private Yahoo article photos and linked MANTAN features", () => {
  it("validates exact article/photo targets, image family and canonical tracking decoration", () => {
    expect(photoFeatureTarget(`${page()}?ext_m=y`)?.url).toBe(page());
    for (const u of [
      page().replace("https:", "http:"),
      page().replace(
        "gravure.mantan-web.jp",
        "gravure.mantan-web.jp.evil.example",
      ),
      `${page()}?url=https://evil`,
      page().replace("https://", "https://user@"),
      page(0),
      `${page()}#x`,
      "http://127.0.0.1/",
    ])
      expect(photoFeatureTarget(u)).toBeNull();
    expect(mantanPhotoUrl(img(), family)).toBe(img());
    expect(mantanPhotoUrl(img(1, 1106, other), family)).toBeNull();
    expect(
      mantanPhotoUrl(
        img().replace("storage.mantan-web.jp", "ads.mantan-web.jp"),
      ),
    ).toBeNull();
  });
  it("chooses the actual full article image over the crop, primary feature before related, and never returns body text", () => {
    const result = parseYahooPhotoMetadata(metadata(), article);
    expect(result.pictures[0]).toMatchObject({
      url: cover,
      caption: "写真説明",
      credit: "配信社",
    });
    expect(result.features.map((f) => f.url)).toEqual([page(), page(1, other)]);
    expect(JSON.stringify(result)).not.toContain("本文全文限定語");
    expect(() =>
      parseYahooPhotoMetadata(metadata(article.replace(/a/g, "b")), article),
    ).toThrow("article_mismatch");
    expect(() =>
      parseYahooPhotoMetadata(
        "<script>window.__PRELOADED_STATE__ = {}; evil()</script>",
        article,
      ),
    ).toThrow();
  });
  it("uses the largest explicitly provided main photo, exact thumbnail roster, and excludes ads and related images", () => {
    const result = parseMantanPhotoPage(gallery(), page());
    expect(result.picture.url).toBe(img());
    expect(result.pages).toEqual([page(), page(2), page(3)]);
    expect(result.thumbnails.map((t) => t.url)).toEqual([
      img(1, 240),
      img(2, 240),
      img(3, 240),
    ]);
    expect(() =>
      parseMantanPhotoPage(
        gallery()
          .replace('class="photo__image"', 'class="ad-photo"')
          .replace('class="photo__image"', 'class="ad-photo"'),
        page(),
      ),
    ).toThrow();
    expect(() =>
      parseMantanPhotoPage(`<div>${"<div>".repeat(161)}${gallery()}`, page()),
    ).toThrow("gallery_too_complex");
    expect(() => parseMantanPhotoPage("x".repeat(2_000_001), page())).toThrow();
  });
  it("accepts publisher-declared image filenames and preserves article-family isolation", () => {
    for (const name of [
      "001_size8",
      "003_size9",
      "004_size10",
      "photo-original_2025",
    ]) {
      const url = img().replace("001.jpg", `${name}.jpg`);
      expect(mantanPhotoUrl(url, family)).toBe(url);
      expect(mantanPhotoUrl(url, other)).toBeNull();
    }
    for (const name of ["../001", "001.svg", "001%2fother", ".hidden"])
      expect(
        mantanPhotoUrl(img().replace("001.jpg", `${name}.jpg`), family),
      ).toBeNull();
  });
  it("resolves the reported 11-photo gallery, including size suffixes in full images and thumbnails", async () => {
    const feature =
      "https://gravure.mantan-web.jp/article/20251206dog00m200056000c/photopage/001.html";
    const html = readFileSync(
      new URL("./fixtures/mantan-photo-suffix.html", import.meta.url),
      "utf8",
    );
    const parsed = parseMantanPhotoPage(html, feature);
    expect(parsed.pages).toHaveLength(11);
    expect(parsed.thumbnails).toHaveLength(11);
    expect(parsed.picture.url).toContain("h=984,f=webp:auto/");
    expect(parsed.picture.url).toMatch(/001_size8\.jpg$/);
    expect(parsed.thumbnails[10].url).toMatch(/011_size10\.jpg$/);
    const service = new YahooPhotoService(
      new MemoryPhotoCache(),
      async (url) =>
        url === article
          ? metadata().replaceAll(`${page()}?ext_m=y`, feature)
          : html,
    );
    const full = await service.imageSource(article, feature, feature, false);
    expect(full.url).toBe(parsed.picture.url);
    const thumb = await service.imageSource(
      article,
      feature,
      parsed.pages[10],
      true,
    );
    expect(thumb.url).toBe(parsed.thumbnails[10].url);
  });
  it("fetches bounded fixed HTML targets without redirects and never acts as an image/URL proxy", async () => {
    const load = vi.fn(
      async () =>
        new Response(metadata(), { headers: { "content-type": "text/html" } }),
    );
    expect(await fetchPhotoHtml(article, load)).toContain("articleDetail");
    expect(load.mock.calls[0]).toMatchObject([article, { redirect: "error" }]);
    for (const u of [
      "http://127.0.0.1/",
      "https://news.yahoo.co.jp/api/anything",
      img(),
      `${article}?url=http://127.0.0.1/`,
    ])
      await expect(fetchPhotoHtml(u, load)).rejects.toThrow(
        "target_not_allowed",
      );
    expect(load).toHaveBeenCalledTimes(1);
    await expect(
      fetchPhotoHtml(
        article,
        async () => new Response("denied", { status: 403 }),
      ),
    ).rejects.toThrow();
    await expect(
      fetchPhotoHtml(
        article,
        async () =>
          new Response("x", {
            headers: {
              "content-type": "text/html",
              "content-length": "2000001",
            },
          }),
      ),
    ).rejects.toThrow("page_too_large");
    await expect(
      fetchPhotoHtml(
        article,
        async () =>
          new Response("x".repeat(2_000_001), {
            headers: { "content-type": "text/html" },
          }),
      ),
    ).rejects.toThrow("page_too_large");
  });
  it("only follows a feature actually linked by the parent and pages actually in its thumbnail roster", async () => {
    const load = vi.fn(async (u: string) =>
      u === article ? metadata() : gallery(u === page(2) ? 2 : 1),
    );
    const s = new YahooPhotoService(new MemoryPhotoCache(), load);
    const first = await s.get(article, page());
    expect(first.kind).toBe("gallery");
    const second = await s.get(article, page(), page(2));
    expect(second.kind === "gallery" && second.picture.url).toBe(img(2));
    await s.get(article, page(), page(2));
    expect(await s.imageSource(article, page(), page(3), true)).toEqual({
      url: img(3, 240),
      referer: page(),
    });
    await expect(s.imageSource(article, page(), page(9), true)).rejects.toThrow(
      "page_not_linked",
    );
    expect(load.mock.calls.map((c) => c[0])).toEqual([
      article,
      page(),
      page(2),
    ]);
    await expect(
      s.get(article, page(1, "20260103dog00m200003000a")),
    ).rejects.toThrow("feature_not_linked");
    await expect(s.get(article, page(), page(9))).rejects.toThrow(
      "page_not_linked",
    );
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("shares concurrent lookups, serves stale success on outage and expires after 24h", async () => {
    let now = 1_000_000,
      down = false;
    const load = vi.fn(async () => {
      if (down) throw Error("down");
      return metadata();
    });
    const s = new YahooPhotoService(new MemoryPhotoCache(), load, () => now);
    await Promise.all([s.get(article), s.get(article)]);
    expect(load).toHaveBeenCalledTimes(1);
    now += 3_600_001;
    down = true;
    expect((await s.get(article)).status).toBe("cached");
    await s.get(article);
    expect(load).toHaveBeenCalledTimes(2);
    now += 86_400_000;
    await expect(s.get(article)).rejects.toThrow();
  });
  it("rejects unknown/malformed inputs and production before any load, with clear retryable errors", async () => {
    const load = vi.fn(async () => metadata()),
      s = new YahooPhotoService(new MemoryPhotoCache(), load);
    for (const tail of [
      "",
      "?article=http://127.0.0.1/",
      `?article=${encodeURIComponent(article)}&url=x`,
      `?article=${encodeURIComponent(article)}&article=x`,
      `?article=${encodeURIComponent(article)}&page=${encodeURIComponent(page())}`,
    ])
      expect(
        (
          await handleYahooPhotos(
            new Request(`https://app/api/yahoo-photos${tail}`),
            s,
            true,
          )
        ).status,
      ).toBe(400);
    const req = () =>
      new Request(
        `https://app/api/yahoo-photos?article=${encodeURIComponent(article)}`,
      );
    expect((await handleYahooPhotos(req(), s, false)).status).toBe(403);
    expect(
      (await handleYahooPhotos(new Request(req(), { method: "POST" }), s, true))
        .status,
    ).toBe(405);
    expect(load).not.toHaveBeenCalled();
    const r = await handleYahooPhotos(req(), s, true);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const failed = new YahooPhotoService(new MemoryPhotoCache(), async () => {
      throw Error("down");
    });
    expect((await handleYahooPhotos(req(), failed, true)).status).toBe(503);
  });
});
