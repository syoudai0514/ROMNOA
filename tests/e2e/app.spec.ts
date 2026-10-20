import { test, expect, type Page } from "@playwright/test";
import { feed } from "../fixtures";

async function fixture(page: Page) {
  await page.route("**/api/articles", (route) => route.fulfill({ json: feed }));
  await page.goto("/");
  await expect(page.getByTestId("article-row").first()).toBeVisible();
}
function nav(page: Page) {
  return page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true });
}

test("discovery → article → save → persistent read and favorites (R04/R05/R06)", async ({
  page,
}) => {
  await fixture(page);
  const first = page.getByTestId("article-row").first();
  await first.getByRole("button", { name: /^記事を開く/ }).click();
  const reader = page.getByRole("dialog");
  await expect(reader).toBeVisible();
  await expect(
    reader.getByText("外部サイトが開きます。広告が表示される場合があります。"),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: "元の記事を読む" }),
  ).toHaveAttribute("href", feed.articles[0].url);
  await expect(
    reader.getByRole("link", { name: "元の記事を読む" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await reader.getByRole("button", { name: "あとで読む" }).click();
  await expect(
    reader.getByRole("button", { name: "保存済み" }),
  ).toHaveAttribute("aria-pressed", "true");
  await reader.getByRole("button", { name: "次の記事" }).click();
  await expect(reader.getByRole("heading", { level: 1 })).toContainText("料理");
  await reader.getByRole("button", { name: "記事を閉じる" }).click();
  await page.reload();
  await expect(
    page.getByTestId("article-row").first().getByText("既読"),
  ).toBeVisible();
  await nav(page).getByRole("button", { name: /^保存/ }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.getByTestId("article-row").first()).toContainText("ゲーム");
  await page.getByRole("button", { name: "閲覧履歴" }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(2);
});

test("search, category, unread order, source and NG word filters (R03/R09/R13)", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("searchbox", { name: "記事を検索" }).fill("休日の料理");
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await page.getByRole("button", { name: "検索をクリア" }).click();
  await page
    .getByLabel("カテゴリで絞り込み")
    .getByRole("button", { name: "ゲーム", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await page
    .getByTestId("article-row")
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await page.getByRole("button", { name: "記事を閉じる" }).click();
  await page
    .getByLabel("カテゴリで絞り込み")
    .getByRole("button", { name: "すべて" })
    .click();
  await page.getByLabel("記事の並び順").selectOption("unread");
  await expect(page.getByTestId("article-row").first()).toContainText("料理");
  await nav(page).getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("switch", { name: "ハムスター速報を表示" }).uncheck();
  await nav(page).getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await nav(page).getByRole("button", { name: "設定", exact: true }).click();
  await page
    .getByRole("textbox", { name: "NGワード", exact: true })
    .fill("スマートフォン");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await nav(page).getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(page.getByText("表示する記事がありません")).toBeVisible();
  await page.reload();
  await expect(page.getByText("表示する記事がありません")).toBeVisible();
});

test("theme, type size, categories and narrow screen fit (R04/R07)", async ({
  page,
}) => {
  await fixture(page);
  await nav(page)
    .getByRole("button", { name: "カテゴリ", exact: true })
    .click();
  await page.getByRole("button", { name: /世の中の、いまを知る/ }).click();
  await expect(page.getByRole("heading", { name: /^ニュース/ })).toBeVisible();
  await nav(page).getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("表示モード").selectOption("dark");
  await page.getByRole("button", { name: "大", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-font", "large");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("feed outage uses browser cache without blocking saved articles (R02)", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^保存する/ })
    .click();
  await page.route("**/api/articles", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.reload();
  await expect(
    page.getByText(/新しい記事を取得できませんでした/),
  ).toBeVisible();
  await expect(page.getByTestId("article-row").first()).toBeVisible();
  await nav(page).getByRole("button", { name: /^保存/ }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
});

test("partial source failure remains usable and sends no requests to external hosts (R02/R10)", async ({
  page,
}) => {
  const outside: string[] = [];
  page.on("request", (req) => {
    if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      outside.push(req.url());
  });
  await page.route("**/api/articles", (route) =>
    route.fulfill({
      json: {
        ...feed,
        sources: [{ ...feed.sources[0], status: "error" }, feed.sources[1]],
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText(/ハムスター速報: 現在取得できません/),
  ).toBeVisible();
  await expect(page.getByTestId("article-row").first()).toBeVisible();
  expect(outside).toEqual([]);
  await expect(
    page.locator('iframe,video,script[src^="https://"]'),
  ).toHaveCount(0);
});

test("dialog traps focus, preserves list scroll and restores detail scroll (R15)", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => scrollTo(0, 600));
  const before = await page.evaluate(() => scrollY);
  const row = page.getByTestId("article-row").nth(6);
  await row.getByRole("button", { name: /^記事を開く/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "記事を閉じる" }),
  ).toBeFocused();
  await page.locator(".reader-content").evaluate((el) => {
    el.scrollTop = 300;
  });
  const detail = await page
    .locator(".reader-content")
    .evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "記事を閉じる" }).click();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(
    before - 200,
  );
  await row.getByRole("button", { name: /^記事を開く/ }).click();
  await expect
    .poll(() => page.locator(".reader-content").evaluate((el) => el.scrollTop))
    .toBe(detail);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("corrupt and blocked local storage show an actionable warning (R06)", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("romnoa:preferences:v1", "{broken"),
  );
  await fixture(page);
  await expect(page.getByRole("alert")).toContainText(
    "保存データを読み込めませんでした",
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^保存する/ })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "端末に保存できませんでした",
  );
});
