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
async function setup(page: Page) {
  const requests: URLSearchParams[] = [];
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
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
    return r.fulfill({
      json: p.has("feature")
        ? gallery(p.get("feature")!, p.get("page") || p.get("feature")!)
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
    .getByRole("button", { name: "ニュースへ", exact: true })
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
    feature.getByRole("heading", { name: "写真特集", exact: true }),
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
  await setup(page);
  const feature = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(feature.locator(".photo-feature-stage img")).toBeVisible();
  let down = true;
  await page.route("**/api/yahoo-photos?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    return r.fulfill(
      down
        ? { status: 503, json: { error: "down" } }
        : {
            json: p.has("feature")
              ? gallery(p.get("feature")!, p.get("page") || p.get("feature")!)
              : meta,
          },
    );
  });
  await feature
    .getByRole("button", { name: "写真特集の次の写真", exact: true })
    .click();
  await expect(feature.getByRole("alert")).toContainText(
    "取得できませんでした",
  );
  await expect(feature.locator(".photo-feature-stage img")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "ニュース内の移動" })
    .getByRole("button", { name: "ニュースへ", exact: true })
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
