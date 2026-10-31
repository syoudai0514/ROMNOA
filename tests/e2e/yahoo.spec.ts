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
  await page.route("**/api/yahoo-topics", (r) =>
    r.fulfill({ json: { articles } }),
  );
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
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "ニュース", exact: true })
    .click();
  await page.getByRole("button", { name: "新着ニュース", exact: true }).click();
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

test("Yahoo opens the body before the image; same-category links, back and next stay inside app", async ({
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
  expect((await img.boundingBox())!.y).toBeGreaterThan(
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
  await page.route("**/api/yahoo-topics", (r) =>
    r.fulfill({ json: { articles } }),
  );
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
  await page.route("**/api/yahoo-topics", (r) =>
    r.fulfill({ json: { articles } }),
  );
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
  await page.route("**/api/yahoo-topics", (r) =>
    r.fulfill({ json: { articles } }),
  );
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
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
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
        richPages: [
          [
            { kind: "text", text: "本文1ページ目\n\n続きの段落" },
            {
              kind: "link",
              text: "本文内のリンク",
              url: "https://example.com/story",
            },
            { kind: "image", text: "本文の写真", url: image },
          ],
          [],
        ],
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
    body.getByRole("link", { name: "本文内のリンク" }),
  ).toHaveAttribute("href", "https://example.com/story");
  await expect(body.getByRole("img", { name: "本文の写真" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /元記事を開く/ }),
  ).toHaveAttribute("href", articles[0].url);
});

test("article back button and bottom navigation work inside the reader", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  await channel(page);
  await page
    .getByRole("button", {
      name: `ニュースを開く: ${articles[0].title}`,
      exact: true,
    })
    .click();
  const reader = page.getByRole("dialog", { name: articles[0].title });
  await expect(
    reader.getByRole("button", { name: "ニュースを閉じる" }),
  ).toBeVisible();
  if (isMobile) {
    const bar = reader.getByRole("navigation", {
      name: "記事内のナビゲーション",
    });
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "検索", exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "下部ナビゲーション" })
        .getByRole("button", { name: "検索", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("categories switch between roundup and news and filter the news list", async ({
  page,
}) => {
  await setup(page);
  await tab(page, "カテゴリ");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "ニュース", exact: true })
    .click();
  await page.getByRole("button", { name: /スポーツ.*ニュースを見る/ }).click();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(1);
  await expect(page.getByTestId("yahoo-row").first()).toContainText(
    articles[2].title,
  );
});

test("article navigation is available without a photo feature", async ({
  page,
}) => {
  await setup(page);
  await channel(page);
  await page
    .getByRole("button", { name: `ニュースを開く: ${articles[1].title}` })
    .click();
  const reader = page.getByRole("dialog", { name: articles[1].title });
  const nav = reader.getByRole("navigation", { name: "ニュース内の移動" });
  await expect(nav.getByRole("button")).toHaveText([
    "ニュース本文",
    "記事の写真",
  ]);
  await nav.getByRole("button", { name: "記事の写真" }).click();
  await expect(
    reader.getByText("表示できる記事の写真はありません。"),
  ).toBeVisible();
});

test("X posts in a Yahoo article show their photos in the app, and shop or related links are not shown", async ({
  page,
}) => {
  await setup(page);
  const post = "https://x.com/official/status/1234567890123";
  const photo = "https://pbs.twimg.com/media/AAA.jpg";
  await page.route(photo, (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>',
    }),
  );
  await page.route("**/api/social?**", (r) =>
    r.fulfill({
      json: {
        provider: "X",
        url: post,
        author: "公式",
        handle: "official",
        text: "撮影オフショット",
        media: [{ type: "photo", url: photo }],
      },
    }),
  );
  await page.route("**/api/yahoo-body?**", (r) =>
    r.fulfill({
      json: {
        article: articles[0].id,
        pages: ["本文"],
        richPages: [
          [
            { kind: "text", text: "本文" },
            { kind: "social", text: "投稿", url: post },
          ],
        ],
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
  const card = page.getByRole("region", { name: "Xの投稿 @official" });
  await expect(card).toContainText("撮影オフショット");
  await card.getByRole("button", { name: "投稿の写真1を拡大" }).click();
  await expect(
    page.getByRole("dialog", { name: "記事画像の拡大表示" }).locator("img"),
  ).toHaveAttribute("src", photo);
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("an unavailable in-app gallery keeps its article photo link usable", async ({
  page,
}) => {
  await setup(page);
  const url = "https://publisher.example/gallery/story";
  await page.route("**/api/yahoo-body?**", (r) =>
    r.fulfill({
      json: {
        article: articles[0].id,
        pages: ["写真を見る"],
        complete: true,
        richPages: [[{ kind: "photo", url, text: "写真を見る" }]],
      },
    }),
  );
  await channel(page);
  await page
    .getByRole("button", { name: `ニュースを開く: ${articles[0].title}` })
    .click();
  const reader = page.getByRole("dialog", { name: articles[0].title });
  await expect(
    reader.getByRole("link", { name: "写真を見る" }),
  ).toHaveAttribute("href", url);
});

test("topics, unread search and selectable result count", async ({ page }) => {
  await setup(page);
  await channel(page);
  await page.getByRole("button", { name: "トピックス", exact: true }).click();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(3);
  await page
    .getByRole("button", { name: `ニュースを開く: ${articles[0].title}` })
    .click();
  await page
    .getByRole("button", { name: "ニュースを閉じる", exact: true })
    .click();
  await tab(page, "検索");
  await page.getByLabel("Yahooニュースの検索語").fill("テスト");
  await page
    .getByRole("search", { name: "Yahooニュースを探す" })
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await page.getByLabel("ニュースの検索候補数").selectOption("100");
  await expect(page.getByLabel("ニュースの検索候補数")).toHaveValue("100");
  await page.getByLabel("未読のみ").check();
  await expect(page.getByTestId("yahoo-row")).toHaveCount(2);
  await expect(page.getByText(articles[0].title)).toHaveCount(0);
});

test("saved news switches between saving order and publication date", async ({
  page,
}) => {
  await setup(page);
  await channel(page);
  await page
    .getByRole("button", { name: `ニュースを保存: ${articles[0].title}` })
    .click();
  await page
    .getByRole("button", { name: `ニュースを保存: ${articles[1].title}` })
    .click();
  await tab(page, "保存");
  await expect(page.getByTestId("yahoo-row").first()).toContainText(
    articles[1].title,
  );
  await page.getByLabel("保存したニュースの並び順").selectOption("date");
  await expect(page.getByTestId("yahoo-row").first()).toContainText(
    articles[0].title,
  );
  await page.getByLabel("保存したニュースの並び順").selectOption("saved");
  await expect(page.getByTestId("yahoo-row").first()).toContainText(
    articles[1].title,
  );
});

test("switches between roundup and news with one tap across tabs", async ({
  page,
}) => {
  await setup(page);
  const switcher = page.getByRole("group", { name: "配信チャンネル" });
  const roundup = switcher.getByRole("button", { name: "まとめ", exact: true });
  const news = switcher.getByRole("button", { name: "ニュース", exact: true });
  await expect(roundup).toHaveAttribute("aria-pressed", "true");
  await news.click();
  await expect(news).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("yahoo-row").first()).toBeVisible();
  await tab(page, "検索");
  await roundup.click();
  await expect(roundup).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("searchbox", { name: "記事を検索" }),
  ).toBeVisible();
  await news.click();
  await expect(page.getByLabel("Yahooニュースの検索語")).toBeVisible();
  await tab(page, "カテゴリ");
  await roundup.click();
  await expect(roundup).toHaveAttribute("aria-pressed", "true");
  await news.click();
  await expect(news).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 320, height: 700 });
  const box = await switcher.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await roundup.click();
  await expect(roundup).toHaveAttribute("aria-pressed", "true");
});
