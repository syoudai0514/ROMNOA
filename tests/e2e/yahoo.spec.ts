import { test, expect, type Page } from "@playwright/test";
import { feed } from "../fixtures";
import {
  yahooCategories,
  filterYahoo,
  type YahooArticle,
} from "../../src/lib/yahoo-model";
const image =
  "https://newsatcl-pctr.c.yimg.jp/t/amd-img/test-news-view.jpg?w=450";
const articles: YahooArticle[] = [
  {
    id: `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`,
    url: `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`,
    title: "[テスト] 今日の天気について(配信社)",
    summary: "気象庁が発表した記事冒頭です。ここまでがRSS配信です。",
    image,
    category: "domestic",
    publishedAt: "2026-10-29T10:00:00Z",
  },
  {
    id: `https://news.yahoo.co.jp/articles/${"b".repeat(40)}`,
    url: `https://news.yahoo.co.jp/articles/${"b".repeat(40)}`,
    title: "[テスト] 国内の交通情報(配信社)",
    summary: "別のニュースの冒頭です。",
    image: null,
    category: "domestic",
    publishedAt: "2026-10-29T09:00:00Z",
  },
  {
    id: `https://news.yahoo.co.jp/articles/${"c".repeat(40)}`,
    url: `https://news.yahoo.co.jp/articles/${"c".repeat(40)}`,
    title: "[テスト] スポーツのニュース(配信社)",
    summary: "試合の結果が発表されました。",
    image: null,
    category: "sports",
    publishedAt: "2026-10-29T08:00:00Z",
  },
];
const response = {
  articles,
  sources: yahooCategories.map((c) => ({
    id: c.id,
    status: "ok",
    fetchedAt: "2026-10-29T10:00:00Z",
  })),
  generatedAt: new Date().toISOString(),
};
async function setup(page: Page) {
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/yahoo", (r) => r.fulfill({ json: response }));
  await page.route("**/api/yahoo-body?**", (r) =>
    r.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.route("**/api/yahoo-photos?**", (r) =>
    r.fulfill({
      json: {
        kind: "article",
        articleId: new URL(r.request().url()).searchParams.get("article"),
        pictures: [],
        features: [],
        status: "ok",
        fetchedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/yahoo-search?**", (r) => {
    const params = new URL(r.request().url()).searchParams,
      q = params.get("q")!,
      scope = params.get("scope") as "title" | "summary";
    return r.fulfill({
      json: {
        query: q,
        scope,
        articles: filterYahoo(articles, q, scope, "all"),
        candidateCount: articles.length,
        providerTotal: articles.length,
        status: "ok",
        fetchedAt: new Date().toISOString(),
      },
    });
  });
  await page.route("https://newsatcl-pctr.c.yimg.jp/**", async (r) => {
    const res = await page.request.get("/icon-192.png");
    return r.fulfill({ contentType: "image/png", body: await res.body() });
  });
  await page.goto("/");
}
async function channel(page: Page) {
  await page
    .getByRole("combobox", { name: "配信チャンネル", exact: true })
    .selectOption("yahoo");
}
async function tab(page: Page, name: string) {
  await page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true })
    .getByRole("button", { name, exact: true })
    .click();
}

test("Yahoo opens image before the title and RSS lead; same-category links, back and next stay inside app", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await channel(page);
  await expect(page.getByTestId("yahoo-row")).toHaveCount(3);
  const firstRow = page.getByTestId("yahoo-row").first();
  await expect(firstRow.locator(".yahoo-list-thumbnail")).toHaveAttribute(
    "src",
    image,
  );
  await expect(firstRow.locator(".yahoo-list-thumbnail")).toHaveJSProperty(
    "naturalWidth",
    192,
  );
  await expect(
    page.getByTestId("yahoo-row").nth(1).locator(".yahoo-list-thumbnail"),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: `ニュースを開く: ${articles[0].title}`,
      exact: true,
    })
    .click();
  const reader = page.getByRole("dialog", {
    name: articles[0].title,
    exact: true,
  });
  await expect(
    reader.getByRole("region", { name: "配信された記事冒頭" }),
  ).toHaveText(articles[0].summary);
  const img = reader.locator(".article-picture img");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect((await img.boundingBox())!.y).toBeLessThan(
    (await reader.getByRole("heading", { level: 1 }).boundingBox())!.y,
  );
  await reader.getByRole("button", { name: /を拡大$/ }).click();
  await expect(
    page.getByRole("dialog", { name: "記事画像の拡大表示" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "拡大画像を閉じる" }).click();
  await expect(
    reader.getByRole("link", { name: /元記事を開く/ }),
  ).toHaveAttribute("href", articles[0].url);
  await reader
    .getByRole("region", { name: "同じカテゴリのニュース" })
    .getByRole("button", { name: articles[1].title })
    .click();
  const next = page.getByRole("dialog", {
    name: articles[1].title,
    exact: true,
  });
  await expect(next).toBeVisible();
  await next.getByRole("button", { name: "元のニュースへ戻る" }).click();
  await expect(reader).toBeVisible();
  await reader.getByRole("button", { name: "次のニュース" }).click();
  await expect(next).toBeVisible();
  await next.getByRole("button", { name: "ニュースを閉じる" }).click();
  await expect(page.getByTestId("yahoo-row").first()).toContainText("既読");
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Yahoo search separates titles from feed leads, has no date restriction, and saved news persists offline", async ({
  page,
}) => {
  await setup(page);
  await channel(page);
  await tab(page, "検索");
  const search = page.getByRole("search", { name: "Yahooニュースを探す" });
  await search.getByRole("searchbox").fill("気象庁");
  await search.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(0);
  await search.getByRole("radio", { name: "タイトル・検索の抜粋" }).check();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await expect(search).toContainText("期間指定なし");
  await expect(
    search.getByRole("link", { name: /続きもYahoo/ }),
  ).toHaveAttribute(
    "href",
    `https://news.yahoo.co.jp/search?p=${encodeURIComponent("気象庁")}`,
  );
  await expect(page.getByTestId("home-filters")).toHaveCount(0);
  await page
    .getByTestId("yahoo-row")
    .getByRole("button", { name: /^ニュースを保存:/ })
    .click();
  await page.reload();
  await channel(page);
  await tab(page, "保存");
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await page.route("**/api/yahoo", (r) =>
    r.fulfill({ status: 503, json: { error: "down" } }),
  );
  await page.getByRole("button", { name: "Yahooニュースを更新" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "端末に残っているニュース" }),
  ).toBeVisible();
  await page
    .getByTestId("yahoo-row")
    .getByRole("button", { name: /^ニュースを開く:/ })
    .click();
  await expect(
    page.getByRole("region", { name: "配信された記事冒頭" }),
  ).toHaveText(articles[0].summary);
  await page.getByRole("button", { name: "ニュースを閉じる" }).click();
  await tab(page, "設定");
  await page.getByText("履歴・既読をリセット", { exact: true }).click();
  await page
    .getByRole("button", { name: "履歴・既読を削除する", exact: true })
    .click();
  await tab(page, "保存");
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await expect(page.getByTestId("yahoo-row")).not.toContainText("既読");
});

test("Yahoo category failures and invalid updates keep safe cached content without breaking roundup", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/yahoo", (r) =>
    r.fulfill({
      json: {
        ...response,
        sources: response.sources.map((s) => ({
          ...s,
          status: s.id === "world" ? "error" : "ok",
        })),
      },
    }),
  );
  await channel(page);
  await expect(
    page.getByRole("status").filter({ hasText: "国際：取得できません" }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "ニュースのカテゴリ" })
    .getByRole("button", { name: "スポーツ", exact: true })
    .click();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await expect(page.getByTestId("yahoo-row")).toContainText("スポーツ");
  await page.route("**/api/yahoo", (r) =>
    r.fulfill({
      json: {
        ...response,
        articles: [{ ...articles[0], image: "https://ads.example/ad.jpg" }],
      },
    }),
  );
  await page.getByRole("button", { name: "Yahooニュースを更新" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "端末に残っているニュース" }),
  ).toBeVisible();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "配信チャンネル", exact: true })
    .selectOption("roundup");
  await expect(page.getByTestId("article-row").first()).toBeVisible();
});

test("removed secret gesture no longer opens a dialog and removed API is unavailable", async ({
  page,
}) => {
  await setup(page);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("hidden-search")) calls.push(r.url());
  });
  const footer = page.locator(".page-footer");
  await footer.scrollIntoViewIfNeeded();
  for (let i = 0; i < 3; i++) await footer.click({ position: { x: 5, y: 8 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toEqual([]);
  expect(
    (
      await page.request.post("/api/hidden-search", { data: { pin: "000000" } })
    ).status(),
  ).toBe(404);
});

test("person-name search finds a story outside every RSS category and preserves snippets through save/reload", async ({
  page,
}) => {
  await setup(page);
  await channel(page);
  const remote: YahooArticle = {
    ...articles[0],
    id: `https://news.yahoo.co.jp/articles/${"d".repeat(40)}`,
    url: `https://news.yahoo.co.jp/articles/${"d".repeat(40)}`,
    title: "[テスト] 岡田紗佳さんの新しいニュース",
    summary: "検索ページに掲載された抜粋です。",
    origin: "search",
    publishedAt: null,
    displayDate: "10/28(水) 11:00",
    provider: "テスト配信社",
  };
  const requests: URLSearchParams[] = [];
  await page.route("**/api/yahoo-search?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    requests.push(p);
    return r.fulfill({
      json: {
        query: p.get("q"),
        scope: p.get("scope"),
        articles: [remote],
        candidateCount: 50,
        providerTotal: 243,
        status: "ok",
        fetchedAt: new Date().toISOString(),
      },
    });
  });
  await tab(page, "検索");
  const form = page.getByRole("search", { name: "Yahooニュースを探す" });
  await form.getByRole("searchbox").fill("岡田紗佳");
  await form.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await expect(page.getByTestId("yahoo-row")).toContainText("岡田紗佳");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests[0].get("q")).toBe("岡田紗佳");
  expect(requests[0].has("date")).toBe(false);
  await expect(
    page.getByRole("status").filter({ hasText: "候補総数は243件" }),
  ).toBeVisible();
  await page
    .getByTestId("yahoo-row")
    .getByRole("button", { name: /^ニュースを保存:/ })
    .click();
  await page
    .getByTestId("yahoo-row")
    .getByRole("button", { name: /^ニュースを開く:/ })
    .click();
  await expect(page.getByRole("region", { name: "検索結果の抜粋" })).toHaveText(
    remote.summary,
  );
  await expect(page.getByRole("dialog", { name: remote.title })).toContainText(
    "本文を取得できませんでした",
  );
  await page.getByRole("button", { name: "ニュースを閉じる" }).click();
  await page.reload();
  await channel(page);
  await tab(page, "保存");
  await expect(page.getByTestId("yahoo-row")).toContainText(remote.title);
  await page
    .getByTestId("yahoo-row")
    .getByRole("button", { name: /^ニュースを開く:/ })
    .click();
  await expect(page.getByRole("region", { name: "検索結果の抜粋" })).toHaveText(
    remote.summary,
  );
});

test("late Yahoo searches cannot replace a newer name and outages are shown as errors rather than zero hits", async ({
  page,
}) => {
  await setup(page);
  await channel(page);
  await tab(page, "検索");
  await page.route("**/api/yahoo-search?**", async (r) => {
    const p = new URL(r.request().url()).searchParams;
    if (p.get("q") === "古い語")
      await new Promise((resolve) => setTimeout(resolve, 500));
    if (p.get("q") === "障害")
      return r.fulfill({ status: 503, json: { error: "down" } });
    return r.fulfill({
      json: {
        query: p.get("q"),
        scope: p.get("scope"),
        articles: [{ ...articles[0], title: p.get("q")! }],
        candidateCount: 1,
        providerTotal: 1,
        status: "ok",
        fetchedAt: new Date().toISOString(),
      },
    });
  });
  const form = page.getByRole("search", { name: "Yahooニュースを探す" });
  await form.getByRole("searchbox").fill("古い語");
  await form.getByRole("button", { name: "検索", exact: true }).click();
  await form.getByRole("searchbox").fill("新しい語");
  await form.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByTestId("yahoo-row")).toContainText("新しい語");
  await page.waitForTimeout(650);
  await expect(page.getByTestId("yahoo-row")).not.toContainText("古い語");
  await form.getByRole("searchbox").fill("障害");
  await form.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("検索できませんでした");
  await expect(page.locator(".yahoo-empty")).toHaveCount(0);
  await expect(page.getByTestId("yahoo-row")).toHaveCount(0);
  await page.getByRole("button", { name: "検索を再試行" }).click();
  await expect(page.getByRole("alert")).toContainText("検索できませんでした");
});

test("Yahoo article shows the full body in order and keeps the source link", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/yahoo-body?**", (r) =>
    r.fulfill({
      json: {
        article: articles[0].id,
        pages: ["本文1ページ目\n\n続きの段落", "本文2ページ目の最後"],
        complete: true,
      },
    }),
  );
  await channel(page);
  await page
    .getByRole("button", {
      name: `ニュースを開く: ${articles[0].title}`,
      exact: true,
    })
    .click();
  const body = page.getByRole("region", { name: "記事本文", exact: true });
  await expect(body).toContainText("本文1ページ目");
  await expect(body).toContainText("本文2ページ目の最後");
  await expect(
    page.getByRole("link", { name: /元記事を開く/ }),
  ).toHaveAttribute("href", articles[0].url);
});
