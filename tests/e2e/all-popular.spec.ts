import { test, expect, type Page } from "@playwright/test";
import { feed, article, readerFixture } from "../fixtures";

const collection = `popular:${"d".repeat(64)}`;
function nav(page: Page) {
  return page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true });
}

test("popularity shows all 80 articles including zeros, and saved unread catalog articles retain authorization", async ({
  page,
}) => {
  const pool = Array.from({ length: 80 }, (_, i) =>
    article(7000 + i, {
      title: `[テスト] 全件対象の記事 ${i}`,
      publishedAt: i === 79 ? null : article(i).publishedAt,
    }),
  );
  const counts = Object.fromEntries(
    pool.map((a, i) => [a.id, i === 79 ? 100 : 0]),
  );
  let metricFailure = false,
    readerScope = "";
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/discovery**", (r) =>
    r.fulfill({
      json: {
        ...feed,
        articles: pool,
        mode: "popular",
        date: null,
        ranks: [],
        limitedSources: [],
        rankingBasis: "bookmarks",
        bookmarks: metricFailure ? null : counts,
        collection,
      },
    }),
  );
  await page.route("**/api/reader**", (r) => {
    readerScope = new URL(r.request().url()).searchParams.get("collection")!;
    return r.fulfill({ json: readerFixture(pool[79]) });
  });
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await page.getByRole("button", { name: "人気", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(80);
  await expect(page.getByTestId("article-row").first()).toContainText(
    pool[79].title,
  );
  await expect(page.locator(".bookmark-metric").first()).toContainText("100件");
  await expect(
    page.getByRole("heading", { name: /人気記事（全取得記事）/ }),
  ).toContainText("80");
  await page
    .getByRole("button", { name: `保存する: ${pool[79].title}`, exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await nav(page).getByRole("button", { name: /^保存/ }).click();
  await page
    .getByRole("button", { name: `記事を開く: ${pool[79].title}`, exact: true })
    .click();
  await expect(page.getByRole("region", { name: "記事本文" })).toBeVisible();
  expect(readerScope).toBe(collection);
  await page.getByRole("button", { name: "記事を閉じる", exact: true }).click();
  await nav(page).getByRole("button", { name: "ホーム", exact: true }).click();
  metricFailure = true;
  await page.getByRole("button", { name: "人気", exact: true }).click();
  await page.getByRole("button", { name: "記事を更新", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(80);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "記事を減らさず、新着順で全件表示" }),
  ).toBeVisible();
  await expect(page.locator(".bookmark-metric")).toHaveCount(0);
});

test("reader spacing stays compact with repeated blank lines, preserves response text and also applies to cached bodies", async ({
  page,
}) => {
  const a = article(8000, { title: "[テスト] 行間を確認する記事" });
  const document = {
    ...readerFixture(a),
    blocks: Array.from({ length: 80 }, (_, i) => ({
      type: "text" as const,
      text:
        i % 2
          ? "実際の本文です。\n\n  \n空白を詰めても内容と改行を残します。"
          : String(i + 1),
    })),
  };
  let requests = 0;
  await page.route("**/api/articles", (r) =>
    r.fulfill({ json: { ...feed, articles: [a] } }),
  );
  await page.route("**/api/reader**", (r) => {
    requests++;
    return r.fulfill({ json: document });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await page
    .getByRole("button", { name: `記事を開く: ${a.title}`, exact: true })
    .click();
  const body = page.getByRole("region", { name: "記事本文" });
  await expect(body.locator(".reader-text-block")).toHaveCount(80);
  expect(await body.locator(".reader-text-block").nth(1).textContent()).toBe(
    "実際の本文です。\n空白を詰めても内容と改行を残します。",
  );
  const size = await body.evaluate((el) => {
    const paragraph = el.querySelector(".reader-text-block")!,
      style = getComputedStyle(paragraph);
    return {
      height: el.getBoundingClientRect().height,
      lineRatio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
      margin: parseFloat(style.marginBottom),
    };
  });
  expect(size.height).toBeLessThan(4000);
  expect(size.lineRatio).toBeLessThanOrEqual(1.6);
  expect(size.margin).toBeLessThanOrEqual(8);
  await page.getByRole("button", { name: "記事を閉じる", exact: true }).click();
  await page.reload();
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await page
    .getByRole("button", { name: `記事を開く: ${a.title}`, exact: true })
    .click();
  await expect(body.locator(".reader-text-block")).toHaveCount(80);
  expect(requests).toBe(1);
  expect(
    await body.locator(".reader-text-block").nth(1).textContent(),
  ).not.toContain("\n\n");
});
