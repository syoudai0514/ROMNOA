import { test, expect, type Page } from "@playwright/test";
import { feed, article, readerFixture } from "../fixtures";
const newer = article(801, {
  title: "[テスト] 新しい検索記事",
  publishedAt: "2024-03-01T00:00:00.000Z",
});
const older = article(802, {
  title: "[テスト] ずっと前の検索記事",
  publishedAt: "2010-03-01T00:00:00.000Z",
});
const collection = (page = 1) => `search:${String(page).repeat(64)}`;
function result(
  query: string,
  page = 1,
  articles = [newer, older],
  bookmarks: Record<string, number> | null = { [newer.id]: 1, [older.id]: 40 },
) {
  return {
    ...feed,
    query,
    page,
    collection: collection(page),
    articles,
    bookmarks,
    nextSources: page === 1 ? ["hamusoku"] : [],
    generatedAt: new Date().toISOString(),
  };
}
async function base(page: Page) {
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
}
async function submit(page: Page, q: string) {
  await page.getByRole("searchbox", { name: "記事を検索" }).fill(q);
  await page.getByRole("button", { name: "検索", exact: true }).click();
}

test("calendar chooses an older year; keyword search ignores dates and sorts by actual bookmark counts", async ({
  page,
}) => {
  await base(page);
  const queries: URLSearchParams[] = [];
  await page.route("**/api/discovery**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    return r.fulfill({
      json: {
        ...feed,
        mode: p.get("mode"),
        date: p.get("date"),
        ranks: [],
        limitedSources: [],
        articles: [older],
      },
    });
  });
  await page.route("**/api/search**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    queries.push(p);
    return r.fulfill({
      json: result(
        p.get("q")!,
        1,
        undefined,
        p.get("q") === "指標なし" ? null : undefined,
      ),
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "年・月から日付を選ぶ", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "掲載日を選ぶ",
    exact: true,
  });
  await picker
    .getByRole("combobox", { name: "年", exact: true })
    .selectOption("2019");
  await picker
    .getByRole("combobox", { name: "月", exact: true })
    .selectOption("3");
  await picker
    .getByRole("button", { name: "2019年3月10日", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /2019-03-10の記事/ }),
  ).toBeVisible();
  await submit(page, "図書館");
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  expect(queries[0].has("date")).toBe(false);
  await expect(page.getByLabel("掲載日", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("article-row").first()).toContainText(
    newer.title,
  );
  await page
    .getByRole("combobox", { name: "記事の並び順" })
    .selectOption("popular");
  await expect(page.getByTestId("article-row").first()).toContainText(
    older.title,
  );
  await expect(page.locator(".bookmark-metric").first()).toContainText("40件");
  await expect(page.locator(".search-results-note")).toContainText(
    "期間を絞らず",
  );
  await submit(page, "指標なし");
  await expect(page.locator(".search-results-note")).toContainText(
    "新着順で表示",
  );
  await expect(page.getByTestId("article-row").first()).toContainText(
    newer.title,
  );
  await expect(page.locator(".bookmark-metric")).toHaveCount(0);
});

test("My Search is visible normally, persists registered terms and searches all periods", async ({
  page,
}) => {
  await base(page);
  let sent = "";
  await page.route("**/api/search**", (r) => {
    sent = new URL(r.request().url()).searchParams.get("q")!;
    return r.fulfill({ json: result(sent) });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "マイ検索", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "マイ検索", exact: true }).click();
  await page
    .getByLabel("マイ検索の登録語", { exact: true })
    .fill("テストの女優名");
  await page
    .getByRole("button", { name: "キーワードを登録", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "マイ検索", exact: true }).click();
  const panel = page.getByRole("region", { name: "マイ検索", exact: true });
  await panel
    .getByRole("button", { name: "テストの女優名", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  expect(sent).toBe("テストの女優名");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "登録語を削除: テストの女優名", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "テストの女優名", exact: true }),
  ).toHaveCount(0);
});

test("three taps on blank space require a PIN; only then verified adult-style hints appear", async ({
  page,
}) => {
  await base(page);
  let attempts = 0;
  await page.route("**/api/hidden-search", (r) => {
    attempts++;
    const pin = r.request().postDataJSON().pin;
    expect(r.request().method()).toBe("POST");
    return r.fulfill(
      pin === "246810"
        ? {
            json: {
              groups: [
                {
                  title: "脚のライン",
                  words: [
                    {
                      label: "美脚",
                      query: "美脚",
                      verifiedCount: 4,
                      verifiedAt: "2026-10-28T00:00:00Z",
                    },
                  ],
                },
              ],
            },
          }
        : { status: 401, json: { error: "違います" } },
    );
  });
  const adult = { ...newer, title: "[テスト] モデル（25歳）の美脚" },
    minor = { ...older, title: "[テスト] 17歳の写真" };
  await page.route("**/api/search**", (r) =>
    r.fulfill({
      json: result(new URL(r.request().url()).searchParams.get("q")!, 1, [
        adult,
        minor,
      ]),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "隠し検索", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "美脚", exact: true }),
  ).toHaveCount(0);
  const footer = page.locator(".page-footer");
  await footer.scrollIntoViewIfNeeded();
  await footer.click({ position: { x: 5, y: 8 } });
  await footer.click({ position: { x: 5, y: 8 } });
  await expect(
    page.getByRole("dialog", { name: "隠しメニューのパスワード", exact: true }),
  ).toHaveCount(0);
  await footer.click({ position: { x: 5, y: 8 } });
  const unlock = page.getByRole("dialog", {
    name: "隠しメニューのパスワード",
    exact: true,
  });
  await unlock.locator("input").fill("000000");
  await unlock.getByRole("button", { name: "開く", exact: true }).click();
  await expect(unlock.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "隠し検索", exact: true }),
  ).toHaveCount(0);
  await unlock.locator("input").fill("246810");
  await unlock.getByRole("button", { name: "開く", exact: true }).click();
  const hints = page.getByRole("region", { name: "隠し検索", exact: true });
  await expect(hints).toBeVisible();
  expect(attempts).toBe(2);
  await hints.getByRole("button", { name: /^美脚/ }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.getByTestId("article-row")).toContainText("25歳");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "隠し検索", exact: true }),
  ).toHaveCount(0);
});

test("further search pages keep their authorization context when a story is saved before reading", async ({
  page,
}) => {
  await base(page);
  const requests: number[] = [];
  let from = "";
  await page.route("**/api/search**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    const n = Number(p.get("page"));
    requests.push(n);
    return r.fulfill({
      json: result(
        p.get("q")!,
        n,
        n === 1 ? [newer] : [older],
        n === 1 ? { [newer.id]: 1 } : { [older.id]: 40 },
      ),
    });
  });
  await page.route("**/api/reader**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    from = p.get("collection")!;
    return r.fulfill({ json: readerFixture(older) });
  });
  await page.goto("/");
  await submit(page, "図書館");
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "さらに過去の記事", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toContainText(older.title);
  expect(requests).toEqual([1, 2]);
  await page
    .getByRole("button", { name: `保存する: ${older.title}`, exact: true })
    .click();
  await page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true })
    .getByRole("button", { name: /^保存/ })
    .click();
  await page
    .getByTestId("article-row")
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("[テスト用本文]");
  expect(from).toBe(collection(2));
});

test("slow or failed searches cannot replace a newer query, and the small screen fits", async ({
  page,
}) => {
  await base(page);
  await page.route("**/api/search**", async (r) => {
    const q = new URL(r.request().url()).searchParams.get("q")!;
    if (q === "遅い") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await r.fulfill({ json: result(q, 1, [older]) }).catch(() => {});
    } else if (q === "失敗")
      await r.fulfill({ status: 503, json: { error: "fail" } });
    else await r.fulfill({ json: result(q, 1, [newer]) });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await submit(page, "遅い");
  await submit(page, "速い");
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.getByTestId("article-row")).toContainText(newer.title);
  await submit(page, "失敗");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "過去記事を検索できませんでした" }),
  ).toBeVisible();
  await expect(page.getByTestId("article-row")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
