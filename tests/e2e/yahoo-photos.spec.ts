import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { feed } from "../fixtures";
import { yahooCategories, type YahooArticle } from "../../src/lib/yahoo-model";
const articleId =
  "https://news.yahoo.co.jp/articles/bbc2204d43c6ab024f4ea97bf054093be008d32d";
const family = "20260902dog00m200045000a",
  secondFamily = "20250909dog00m200049000c";
const pageUrl = (n = 1, f = family) =>
  `https://gravure.mantan-web.jp/article/${f}/photopage/${String(n).padStart(3, "0")}.html`;
const picture = (n = 1, f = family, w = 1106) =>
  `https://storage.mantan-web.jp/w=${w},f=webp:auto/images/2026/09/02/${f}/${String(n).padStart(3, "0")}.jpg`;
const display = (n = 1, f = family) =>
  `/api/yahoo-photo-image?${new URLSearchParams({ article: articleId, feature: pageUrl(1, f), page: pageUrl(n, f), size: "full" })}`;
const cover =
  "https://newsatcl-pctr.c.yimg.jp/t/amd-img/20261026-test-view.jpg?exp=10800";
const article: YahooArticle = {
  id: articleId,
  url: articleId,
  title: "[テスト] 大きい写真と写真特集のニュース",
  summary: "ニュースの説明文です。写真の後でもすぐ読めます。",
  category: "entertainment",
  publishedAt: null,
  origin: "search",
  image: `${cover}&w=192&h=192`,
};
const features = [
  { title: "【写真特集】この記事の5枚の写真", url: pageUrl() },
  { title: "関連する別の写真特集", url: pageUrl(1, secondFamily) },
];
const meta = {
  kind: "article",
  articleId,
  pictures: [
    {
      url: cover,
      alt: "記事の大きい写真",
      caption: "配信元の写真",
      credit: "MANTAN",
    },
  ],
  features,
  fetchedAt: new Date().toISOString(),
  status: "ok",
};
function gallery(feature = pageUrl(), page = feature) {
  const f = feature.includes(secondFamily) ? secondFamily : family;
  const n = Number(page.match(/\/(\d{3})\.html$/)![1]);
  return {
    kind: "gallery",
    articleId,
    featureUrl: feature,
    pageUrl: page,
    picture: {
      url: picture(n, f),
      alt: `写真特集の写真${n}`,
      caption: `写真${n}`,
      credit: "MANTANWEB",
    },
    pages: [1, 2, 3, 4, 5].map((n) => pageUrl(n, f)),
    thumbnails: [1, 2, 3, 4, 5].map((n) => ({
      pageUrl: pageUrl(n, f),
      url: picture(n, f, 240),
    })),
    title: "写真特集",
    fetchedAt: new Date().toISOString(),
    status: "ok",
  };
}
async function setup(
  page: Page,
  generic = false,
  failNext?: () => boolean,
  multiple = false,
) {
  const requests: URLSearchParams[] = [];
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/yahoo-body?**", (r) =>
    r.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.route("**/api/yahoo", (r) =>
    r.fulfill({
      json: {
        articles: [article],
        sources: yahooCategories.map((c) => ({
          id: c.id,
          status: "ok",
          fetchedAt: new Date().toISOString(),
        })),
        generatedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/yahoo-photos?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    requests.push(p);
    if (p.get("page") === pageUrl(2) && failNext?.())
      return r.fulfill({ status: 503, json: { error: "down" } });
    if (generic) {
      const url = "https://www.j-cast.com/photo/2026/10/25518638.html?num=2";
      const pages = [url, `${url}#romnoa-photo-2`];
      return r.fulfill({
        json: p.has("feature")
          ? {
              ...gallery(),
              featureUrl: url,
              pageUrl: p.get("page") || url,
              pages,
              picture: {
                url: "https://www.j-cast.com/images/2.jpg",
                alt: "写真",
              },
              thumbnails: pages.map((pageUrl) => ({
                pageUrl,
                url: "https://www.j-cast.com/images/2.jpg",
              })),
            }
          : { ...meta, features: [{ title: "【画像】リンク先", url }] },
      });
    }
    return r.fulfill({
      json: p.has("feature")
        ? gallery(p.get("feature")!, p.get("page") || p.get("feature")!)
        : multiple
          ? {
              ...meta,
              pictures: [
                meta.pictures[0],
                {
                  ...meta.pictures[0],
                  url: `${cover}&second=1`,
                  alt: "二枚目",
                },
              ],
            }
          : meta,
    });
  });
  const full = await sharp({
    create: { width: 1106, height: 830, channels: 3, background: "#84a999" },
  })
    .png()
    .toBuffer();
  const small = await sharp({
    create: { width: 192, height: 192, channels: 3, background: "#e2b28a" },
  })
    .png()
    .toBuffer();
  await page.route("https://newsatcl-pctr.c.yimg.jp/**", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: r.request().url().includes("w=192") ? small : full,
    }),
  );
  await page.route("**/api/yahoo-photo-image?**", (r) =>
    r.fulfill({ contentType: "image/png", body: full }),
  );
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "配信チャンネル", exact: true })
    .selectOption("yahoo");
  await page
    .getByRole("button", {
      name: `ニュースを開く: ${article.title}`,
      exact: true,
    })
    .click();
  return requests;
}

test("full article photo and photo feature appear inline automatically, with five thumbnails and an immediate news jump", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests = await setup(page);
  const reader = page.getByRole("dialog", { name: article.title, exact: true });
  const coverPhoto = reader.locator(
    ".yahoo-photo-section .article-picture img",
  );
  await expect(coverPhoto).toHaveAttribute("src", cover);
  await expect(coverPhoto).toHaveJSProperty("naturalWidth", 1106);
  if (page.viewportSize()!.width < 800)
    expect((await coverPhoto.boundingBox())!.width).toBeGreaterThan(300);
  const feature = reader.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(),
  );
  await expect(feature.locator(".photo-feature-stage img")).toHaveJSProperty(
    "naturalWidth",
    1106,
  );
  await expect(
    feature
      .getByRole("group", { name: "写真特集の写真一覧" })
      .getByRole("button"),
  ).toHaveCount(5);
  expect(requests.some((r) => r.get("feature") === pageUrl())).toBe(true);
  await reader
    .getByRole("navigation", { name: "ニュース内の移動" })
    .getByRole("button", { name: "ニュース本文", exact: true })
    .click();
  await expect(
    reader.getByRole("heading", { name: article.title, exact: true }),
  ).toBeInViewport();
  await expect(
    reader.getByRole("region", { name: "検索結果の抜粋" }),
  ).toContainText(article.summary);
  await reader
    .getByRole("navigation", { name: "ニュース内の移動" })
    .getByRole("button", { name: "写真特集", exact: true })
    .click();
  await expect(
    feature.getByRole("heading", { name: "リンク先の写真", exact: true }),
  ).toBeInViewport();
  expect(page.context().pages()).toHaveLength(1);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("feature next/previous, thumbnail choice, swipe and zoom work without leaving the article", async ({
  page,
}) => {
  await setup(page);
  const feature = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(feature.locator(".photo-feature-stage img")).toBeVisible();
  await feature
    .getByRole("button", { name: "写真特集の次の写真", exact: true })
    .click();
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(2),
  );
  await feature
    .getByRole("button", { name: "写真特集の5枚目を表示", exact: true })
    .click();
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(5),
  );
  await expect(
    feature.getByRole("button", { name: "写真特集の次の写真", exact: true }),
  ).toBeDisabled();
  await feature
    .getByRole("button", { name: "写真特集の前の写真", exact: true })
    .click();
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(4),
  );
  await feature.locator(".photo-feature-stage").evaluate((el) => {
    const start = new Event("touchstart", { bubbles: true });
    Object.defineProperty(start, "touches", {
      value: [{ clientX: 200, clientY: 100 }],
    });
    el.dispatchEvent(start);
    const end = new Event("touchend", { bubbles: true });
    Object.defineProperty(end, "changedTouches", {
      value: [{ clientX: 40, clientY: 105 }],
    });
    el.dispatchEvent(end);
  });
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(5),
  );
  await feature
    .getByRole("button", { name: "写真特集の写真を拡大", exact: true })
    .click();
  const zoom = page.getByRole("dialog", {
    name: "記事画像の拡大表示",
    exact: true,
  });
  await expect(zoom).toBeVisible();
  await expect(zoom.locator(".image-viewer-canvas img")).toHaveAttribute(
    "src",
    display(5),
  );
  await zoom
    .getByRole("button", { name: "拡大画像を閉じる", exact: true })
    .click();
  await page
    .getByRole("region", { name: "この記事の写真特集", exact: true })
    .getByRole("button", { name: features[1].title, exact: true })
    .click();
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(1, secondFamily),
  );
  expect(page.context().pages()).toHaveLength(1);
});

test("photo failures offer retry while keeping news readable, and a failed next photo never shows another photo as current", async ({
  page,
}) => {
  let down = true;
  await setup(page, false, () => down);
  const feature = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(feature.locator(".photo-feature-stage img")).toBeVisible();
  await feature
    .getByRole("button", { name: "写真特集の次の写真", exact: true })
    .click();
  await expect(feature.getByRole("alert")).toContainText(
    "取得できませんでした",
  );
  await expect(feature.locator(".photo-feature-stage img")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "ニュース内の移動" })
    .getByRole("button", { name: "ニュース本文", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "検索結果の抜粋" }),
  ).toContainText(article.summary);
  down = false;
  await feature
    .getByRole("button", { name: "写真を再読み込み", exact: true })
    .click();
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(2),
  );
});

test("ordinary publisher links render and switch synthetic photo pages", async ({
  page,
}) => {
  const requests = await setup(page, true);
  const region = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(
    region.getByRole("heading", { name: "リンク先の写真" }),
  ).toBeVisible();
  await expect(region.locator(".photo-feature-stage img")).toHaveJSProperty(
    "naturalWidth",
    1106,
  );
  await region
    .getByRole("button", { name: "写真特集の次の写真", exact: true })
    .click();
  await expect(region).toContainText("2 / 2");
  await expect(region.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    /romnoa-photo-2/,
  );
  expect(requests.some((p) => p.get("page")?.endsWith("#romnoa-photo-2"))).toBe(
    true,
  );
});

test("adjacent photos are prefetched and the photo area stays stable during navigation", async ({
  page,
}) => {
  const images: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/yahoo-photo-image?"))
      images.push(request.url());
  });
  const requests = await setup(page);
  const region = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(region.locator(".photo-feature-stage img")).toHaveJSProperty(
    "naturalWidth",
    1106,
  );
  await expect
    .poll(() => requests.some((p) => p.get("page") === pageUrl(2)))
    .toBe(true);
  await expect
    .poll(() =>
      images.some((url) => {
        const p = new URL(url).searchParams;
        return p.get("page") === pageUrl(2) && p.get("size") === "full";
      }),
    )
    .toBe(true);
  const before = await region
    .locator(".photo-feature-stage")
    .evaluate((el) => el.getBoundingClientRect().height);
  await region
    .getByRole("button", { name: "写真特集の次の写真", exact: true })
    .click();
  await expect(region).toContainText("2 / 5");
  await expect(region.locator(".photo-feature-stage img")).toHaveJSProperty(
    "naturalWidth",
    1106,
  );
  const after = await region
    .locator(".photo-feature-stage")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(before - after)).toBeLessThan(2);
});

test("enlarged gallery supports buttons and swipe, and restores the selected photo", async ({
  page,
}) => {
  await setup(page);
  const feature = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await feature
    .getByRole("button", { name: "写真特集の3枚目を表示", exact: true })
    .click();
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(3),
  );
  await feature
    .getByRole("button", { name: "写真特集の写真を拡大", exact: true })
    .click();
  const viewer = page.getByRole("dialog", {
    name: "記事画像の拡大表示",
    exact: true,
  });
  await expect(viewer).toContainText("3 / 5");
  await viewer.getByRole("button", { name: "次の画像", exact: true }).click();
  await expect(viewer.locator(".image-viewer-canvas img")).toHaveAttribute(
    "src",
    display(4),
  );
  await viewer.getByRole("button", { name: "前の画像", exact: true }).click();
  await expect(viewer).toContainText("3 / 5");
  await viewer.locator(".image-viewer-canvas").evaluate((el) => {
    const start = new Event("touchstart", { bubbles: true });
    Object.defineProperty(start, "touches", {
      value: [{ clientX: 200, clientY: 100 }],
    });
    el.dispatchEvent(start);
    const end = new Event("touchend", { bubbles: true });
    Object.defineProperty(end, "changedTouches", {
      value: [{ clientX: 30, clientY: 110 }],
    });
    el.dispatchEvent(end);
  });
  await expect(viewer).toContainText("4 / 5");
  await viewer
    .getByRole("button", { name: "拡大画像を閉じる", exact: true })
    .click();
  await expect(feature.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    display(4),
  );
  await expect(feature).toContainText("4 / 5");
});

test("article pictures navigate horizontally and zoom keeps the chosen image", async ({
  page,
}) => {
  await setup(page, false, undefined, true);
  const reader = page.getByRole("dialog", { name: article.title });
  const nav = reader.getByRole("navigation", { name: "ニュース内の移動" });
  await expect(nav.getByRole("button")).toHaveText([
    "ニュース本文",
    "記事の写真",
    "写真特集",
  ]);
  await nav.getByRole("button", { name: "記事の写真" }).click();
  const gallery = reader.getByRole("region", { name: "この記事の画像" });
  await expect(
    gallery.getByRole("group", { name: "記事の写真一覧" }).getByRole("button"),
  ).toHaveCount(2);
  await gallery.getByRole("button", { name: "記事の次の写真" }).click();
  await expect(gallery.locator(".article-gallery-stage img")).toHaveAttribute(
    "alt",
    "二枚目",
  );
  await gallery.getByRole("button", { name: "二枚目を拡大" }).click();
  await page.getByRole("button", { name: "前の画像" }).click();
  await page.getByRole("button", { name: "拡大画像を閉じる" }).click();
  await expect(gallery.locator(".article-gallery-stage img")).toHaveAttribute(
    "alt",
    "記事の大きい写真",
  );
});

test("publisher gallery exposes its embedded Instagram post alongside its photographs", async ({
  page,
}) => {
  await setup(page);
  const post = "https://www.instagram.com/p/De_fIWIE2-9/";
  await page.route("**/api/social?**", (r) =>
    r.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.route("**/api/yahoo-photos?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    return r.fulfill({
      json: p.has("feature")
        ? {
            ...gallery(p.get("feature")!, p.get("page") || p.get("feature")!),
            posts: [{ provider: "Instagram", url: post }],
          }
        : meta,
    });
  });
  await page.reload();
  await page
    .getByRole("combobox", { name: "配信チャンネル", exact: true })
    .selectOption("yahoo");
  await page
    .getByRole("button", {
      name: `ニュースを開く: ${article.title}`,
      exact: true,
    })
    .click();
  const reader = page.getByRole("dialog", { name: article.title, exact: true });
  await expect(
    reader.getByRole("link", { name: /Instagramで開く/ }),
  ).toHaveAttribute("href", post);
  await expect(
    reader
      .getByRole("group", { name: "写真特集の写真一覧" })
      .getByRole("button"),
  ).toHaveCount(5);
});

test("a one-image fallback does not claim that the complete gallery has one photo", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/yahoo-photos?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    const g = gallery();
    return r.fulfill({
      json: p.has("feature")
        ? {
            ...g,
            complete: false,
            pages: [g.featureUrl],
            thumbnails: g.thumbnails.slice(0, 1),
          }
        : meta,
    });
  });
  await page.reload();
  await page
    .getByRole("combobox", { name: "配信チャンネル", exact: true })
    .selectOption("yahoo");
  await page
    .getByRole("button", {
      name: `ニュースを開く: ${article.title}`,
      exact: true,
    })
    .click();
  const feature = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(
    feature.getByText("写真一覧をすべて取得できたか確認できていません。", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    feature.getByRole("link", { name: "元の写真ページで確認" }),
  ).toHaveAttribute("href", pageUrl());
  await expect(feature.getByText("1 / 1", { exact: true })).toHaveCount(0);
});
