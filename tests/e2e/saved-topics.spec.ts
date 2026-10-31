import { test, expect } from "@playwright/test";
import { article, feed } from "../fixtures";
import { defaults } from "../../src/lib/storage";
const titles = ["岡田紗佳さん、美脚の写真集を公開", "岡田紗佳、美脚が話題に", "新しいゲームが発売"];
for (const channel of ["ニュース", "まとめ"]) {
  test(`${channel}: saved titles classify, filter, clear and update after removal`, async ({ page }) => {
    const roundup = titles.map((title, i) => article(i, { title }));
    const news = titles.map((title, i) => { const id = `https://news.yahoo.co.jp/articles/${String(i + 1).padStart(40, "0")}`; return { id, url: id, title, summary: "", image: null, category: "entertainment", publishedAt: null }; });
    await page.addInitScript(({ roundup, news, defaults }) => {
      if (localStorage.getItem("saved-topic-test")) return;
      localStorage.setItem("saved-topic-test", "1");
      localStorage.setItem("romnoa:preferences:v1", JSON.stringify({ ...defaults, saved: roundup }));
      localStorage.setItem("romnoa:yahoo-library:v1", JSON.stringify({ saved: news, read: {} }));
    }, { roundup, news, defaults });
    await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
    await page.route("**/api/yahoo", (r) => r.fulfill({ json: { articles: news, sources: [], generatedAt: new Date().toISOString() } }));
    await page.route("**/api/yahoo-topics", (r) => r.fulfill({ json: { articles: [] } }));
    await page.goto("/");
    await page.getByRole("group", { name: "配信チャンネル" }).getByRole("button", { name: channel, exact: true }).click();
    await page.getByRole("navigation", { name: /メインナビゲーション|下部ナビゲーション/ }).filter({ visible: true }).getByRole("button", { name: "保存", exact: true }).click();
    const filters = page.getByRole("region", { name: "保存記事の自動分類" });
    const rows = page.getByTestId(channel === "ニュース" ? "yahoo-row" : "article-row");
    await expect(rows).toHaveCount(3);
    await filters.getByLabel("名前・キーワードで絞り込み").fill("見つからない語");
    await expect(rows).toHaveCount(0);
    await expect(page.getByText(/この条件に一致する保存記事はありません/)).toBeVisible();
    await filters.getByRole("button", { name: "絞り込みを解除" }).click();
    await expect(rows).toHaveCount(3);
    await filters.getByRole("group", { name: "人物・グループ" }).getByRole("button", { name: /岡田紗佳/ }).click();
    await expect(rows).toHaveCount(2);
    await filters.getByLabel("名前・キーワードで絞り込み").fill("写真集");
    await expect(rows).toHaveCount(1);
    await filters.getByRole("button", { name: "絞り込みを解除" }).click();
    await expect(rows).toHaveCount(3);
    await filters.getByRole("group", { name: "キーワード" }).getByRole("button", { name: /写真集/ }).click();
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole("button", { name: channel === "ニュース" ? /^ニュースの保存を解除:/ : /^保存を解除:/ }).click();
    await expect(rows).toHaveCount(2);
    await expect(filters.getByRole("group", { name: "キーワード" }).getByRole("button", { name: /写真集/ })).toHaveCount(0);
    await page.reload();
    await page.getByRole("group", { name: "配信チャンネル" }).getByRole("button", { name: channel, exact: true }).click();
    await page.getByRole("navigation", { name: /メインナビゲーション|下部ナビゲーション/ }).filter({ visible: true }).getByRole("button", { name: "保存", exact: true }).click();
    await expect(rows).toHaveCount(2);
  });
}
