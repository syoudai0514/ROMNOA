import { test, expect, type Page } from "@playwright/test";
import { feed } from "../fixtures";
import { yahooCategories, filterYahoo, type YahooArticle } from "../../src/lib/yahoo-model";

const articles: YahooArticle[] = [0, 1, 2].map((i) => ({
  id: `https://news.yahoo.co.jp/articles/${String(i).repeat(40)}`,
  url: `https://news.yahoo.co.jp/articles/${String(i).repeat(40)}`,
  title: `[テスト] 並び順のニュース ${i}(配信社)`,
  summary: "記事冒頭です。",
  image: null,
  category: "domestic",
  // Provider order is 0,1,2 but the newest is 2.
  publishedAt: new Date(Date.UTC(2026, 9, 29, 8 + i)).toISOString(),
}));
async function setup(page: Page) {
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/yahoo-topics", (r) => r.fulfill({ json: { articles } }));
  await page.route("**/api/yahoo", (r) =>
    r.fulfill({ json: { articles, sources: yahooCategories.map((c) => ({ id: c.id, status: "ok", fetchedAt: "2026-10-29T10:00:00Z" })), generatedAt: new Date().toISOString() } }),
  );
  await page.route("**/api/yahoo-body?**", (r) => r.fulfill({ status: 502, json: { error: "unavailable" } }));
  await page.route("**/api/yahoo-photos?**", (r) =>
    r.fulfill({ json: { kind: "article", articleId: new URL(r.request().url()).searchParams.get("article"), pictures: [], features: [], status: "ok", fetchedAt: new Date().toISOString() } }),
  );
  await page.route("**/api/yahoo-search?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    return r.fulfill({ json: { query: p.get("q"), scope: p.get("scope"), articles: filterYahoo(articles, p.get("q")!, "title", "all", true), candidateCount: 3, providerTotal: 3, status: "ok", fetchedAt: new Date().toISOString() } });
  });
  await page.goto("/");
}
const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name: /メインナビゲーション|下部ナビゲーション/ }).filter({ visible: true }).getByRole("button", { name, exact: true }).click();
const channel = (page: Page, name: string) =>
  page.getByRole("group", { name: "配信チャンネル" }).first().getByRole("button", { name, exact: true }).click();

test("news reader toggles read state and opened news appears in history", async ({ page }) => {
  await setup(page);
  await channel(page, "ニュース");
  await page.getByRole("button", { name: "新着ニュース", exact: true }).click();
  await page.getByRole("button", { name: `ニュースを開く: ${articles[1].title}` }).click();
  const toggle = page.getByRole("button", { name: "未読に戻す" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(page.getByRole("button", { name: "既読にする" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "ニュースを閉じる" }).click();
  await nav(page, "保存");
  await page.getByRole("button", { name: "閲覧履歴" }).click();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await expect(page.getByTestId("yahoo-row")).toContainText(articles[1].title);
  // History survives a reload.
  await page.reload();
  await channel(page, "ニュース");
  await nav(page, "保存");
  await page.getByRole("button", { name: "閲覧履歴" }).click();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
});

test("news search has shared my-search words and a result order", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("romnoa:my-search:v1", JSON.stringify(["並び順"])));
  await setup(page);
  await channel(page, "ニュース");
  await nav(page, "検索");
  await page.getByRole("button", { name: "マイ検索", exact: true }).click();
  await page.getByRole("region", { name: "マイ検索" }).getByRole("button", { name: "並び順", exact: true }).click();
  const rows = page.getByTestId("yahoo-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("ニュース 0");
  await page.getByLabel("ニュース検索結果の並び順").selectOption("newest");
  await expect(rows.first()).toContainText("ニュース 2");
});

test("roundup search can show only unread articles", async ({ page }) => {
  await setup(page);
  await channel(page, "まとめ");
  await nav(page, "検索");
  await page.getByRole("searchbox", { name: "記事を検索" }).fill("テスト用");
  const rows = page.getByTestId("article-row");
  const total = await rows.count();
  expect(total).toBeGreaterThan(1);
  await rows.first().getByRole("button").first().click();
  await page.getByRole("button", { name: /閉じる|戻る/ }).first().click();
  await page.getByRole("checkbox", { name: "未読のみ" }).check();
  await expect(rows).toHaveCount(total - 1);
});
