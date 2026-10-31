import { test, expect, type Page } from "@playwright/test";
import { feed, article } from "../fixtures";

function nav(page: Page) {
  return page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true });
}

test("home immediately shows dense articles and new/popular controls; search has its own tab", async ({
  page,
}) => {
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await expect(page.getByTestId("article-row").first()).toBeVisible();
  await expect(page.locator(".welcome-card")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新着", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "人気", exact: true }),
  ).toBeVisible();
  const measurements = await page.evaluate(() => {
    const bottom = document
      .querySelector(".bottom-nav")!
      .getBoundingClientRect().top;
    const rows = [
      ...document.querySelectorAll('[data-testid="article-row"]'),
    ].map((el) => el.getBoundingClientRect());
    const save = document
      .querySelector(".save-button")!
      .getBoundingClientRect();
    const popular = [
      ...document.querySelectorAll(".quick-sort button"),
    ][1].getBoundingClientRect();
    return {
      visible: rows.filter((r) => r.top >= 0 && r.bottom <= bottom).length,
      firstTop: rows[0].top,
      maxHeight: Math.max(...rows.map((r) => r.height)),
      saveWidth: save.width,
      saveHeight: save.height,
      popularHeight: popular.height,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(measurements.visible).toBeGreaterThanOrEqual(5);
  expect(measurements.firstTop).toBeLessThan(220);
  expect(measurements.maxHeight).toBeLessThan(115);
  expect(measurements.saveWidth).toBeGreaterThanOrEqual(44);
  expect(measurements.saveHeight).toBeGreaterThanOrEqual(44);
  expect(measurements.popularHeight).toBeGreaterThanOrEqual(44);
  expect(measurements.overflow).toBe(false);
  await expect(nav(page).getByRole("button")).toHaveCount(5);
  await nav(page).getByRole("button", { name: "検索", exact: true }).click();
  await expect(
    page.getByRole("searchbox", { name: "記事を検索" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "タイトルのみ", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "マイ検索", exact: true }),
  ).toBeVisible();
  await nav(page).getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});

test("home popularity and search bookmark sorting stay independent across tabs", async ({
  page,
}) => {
  const found = article(9300, {
    title: "[テスト] 名前検索で見つかる過去の記事",
    publishedAt: "2010-03-01T00:00:00Z",
  });
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/discovery**", (r) =>
    r.fulfill({
      json: {
        ...feed,
        articles: [feed.articles[0]],
        mode: "popular",
        date: null,
        ranks: [{ id: feed.articles[0].id, rank: 1 }],
        limitedSources: [],
      },
    }),
  );
  let searchRequests = 0;
  await page.route("**/api/search**", (r) => {
    searchRequests++;
    const p = new URL(r.request().url()).searchParams;
    return r.fulfill({
      json: {
        ...feed,
        articles: [found],
        bookmarks: { [found.id]: 12 },
        scope: p.get("scope"),
        query: p.get("q"),
        page: 1,
        collection: `search:${"a".repeat(64)}`,
        nextSources: [],
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await page.getByRole("button", { name: "人気", exact: true }).click();
  await expect(page.locator(".rank-label strong")).toHaveText(["1位"]);
  expect(searchRequests).toBe(0);
  await nav(page).getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("searchbox", { name: "記事を検索" }).fill("名前");
  await page
    .getByRole("region", { name: "記事を探す", exact: true })
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toContainText(found.title);
  await expect(
    page.getByRole("combobox", { name: "記事の並び順" }),
  ).toHaveValue("newest");
  await page
    .getByRole("combobox", { name: "記事の並び順" })
    .selectOption("popular");
  await expect(page.locator(".bookmark-metric")).toContainText("12件");
  await nav(page).getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "人気", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rank-label strong")).toHaveText(["1位"]);
  await page.getByRole("button", { name: "新着", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(
    feed.articles.length,
  );
  await nav(page).getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "記事を検索" })).toHaveValue(
    "名前",
  );
  await expect(
    page.getByRole("combobox", { name: "記事の並び順" }),
  ).toHaveValue("popular");
  await expect(page.getByTestId("article-row")).toContainText(found.title);
});
