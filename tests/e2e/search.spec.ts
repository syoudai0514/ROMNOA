import { test, expect, type Page } from "@playwright/test";
import { defaults, STORAGE_KEY } from "../../src/lib/storage";
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
  nextSources: ("hamusoku" | "alfalfa")[] = [],
) {
  return {
    ...feed,
    query,
    page,
    collection: collection(page),
    articles,
    bookmarks,
    nextSources,
    candidateCount: articles.length,
    searchedRange: {
      from: "2010-03-01T00:00:00.000Z",
      to: "2024-03-01T00:00:00.000Z",
    },
    generatedAt: new Date().toISOString(),
  };
}
async function base(page: Page) {
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
}
async function searchTab(page: Page) {
  const button = page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true })
    .getByRole("button", { name: "検索", exact: true });
  if ((await button.getAttribute("aria-current")) !== "page")
    await button.click();
}
async function submit(page: Page, q: string) {
  await searchTab(page);
  await page.getByRole("searchbox", { name: "記事を検索" }).fill(q);
  await page
    .getByRole("region", { name: "記事を探す", exact: true })
    .getByRole("button", { name: "検索", exact: true })
    .click();
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
  await page.getByTestId("home-filters").locator("summary").click();
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
    "全期間（日付の制限なし）",
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
  await searchTab(page);
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
  await searchTab(page);
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
        n === 1 ? ["hamusoku"] : [],
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
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  await expect(
    page.getByTestId("article-row").filter({ hasText: older.title }),
  ).toBeVisible();
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

test("search target defaults to titles, switches to clean body and keeps scope for sorting and pagination", async ({
  page,
}) => {
  await base(page);
  const sent: URLSearchParams[] = [];
  await page.route("**/api/search**", async (r) => {
    const p = new URL(r.request().url()).searchParams;
    sent.push(p);
    const scope = p.get("scope")!,
      n = Number(p.get("page"));
    await r.fulfill({
      json: {
        ...result(p.get("q")!, n, scope === "body" ? [newer, older] : [newer]),
        scope,
        unverifiedCount: scope === "body" ? 1 : 0,
        excludedCount: 3,
      },
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await searchTab(page);
  await expect(
    page.getByRole("radio", { name: "タイトルのみ", exact: true }),
  ).toBeChecked();
  await submit(page, "図書館");
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  expect(sent[0].get("scope")).toBe("title");
  await page.getByRole("radio", { name: "本文を含む", exact: true }).check();
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  await expect(page.locator(".search-results-note")).toContainText(
    "おすすめ欄・関連記事・広告・リンクの文字は検索対象から除外",
  );
  await expect(page.locator(".search-results-note")).toContainText(
    "確認できなかった 1件は表示していません",
  );
  await page
    .getByRole("combobox", { name: "記事の並び順" })
    .selectOption("popular");
  await expect(page.getByTestId("article-row").first()).toContainText(
    older.title,
  );
  expect(sent.at(-1)?.get("scope")).toBe("body");
  await page.getByRole("radio", { name: "タイトルのみ", exact: true }).check();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.locator(".search-pagination")).toContainText(
    "1ページ分を検索済み",
  );
  expect(sent.at(-1)?.get("scope")).toBe("title");
  expect(sent.at(-1)?.has("date")).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("an empty title-filtered page still offers older results and late body responses cannot overwrite titles", async ({
  page,
}) => {
  await base(page);
  await page.route("**/api/search**", async (r) => {
    const p = new URL(r.request().url()).searchParams;
    const scope = p.get("scope")!,
      n = Number(p.get("page"));
    if (scope === "body")
      await new Promise((resolve) => setTimeout(resolve, 600));
    await r
      .fulfill({
        json: {
          ...result(
            p.get("q")!,
            n,
            n <= 5 ? [] : [older],
            undefined,
            n <= 5 ? ["hamusoku"] : [],
          ),
          scope,
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await submit(page, "図書館");
  await expect(page.locator(".search-results-note")).toContainText(
    "ここまで一致する記事はありません",
  );
  await expect(
    page.getByRole("button", { name: "さらに過去の記事", exact: true }),
  ).toBeEnabled();
  await page.getByRole("radio", { name: "本文を含む", exact: true }).check();
  await page.getByRole("radio", { name: "タイトルのみ", exact: true }).check();
  await expect(page.locator(".search-results-note")).toContainText(
    "タイトルに検索語が含まれる",
  );
  await page
    .getByRole("button", { name: "さらに過去の記事", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toContainText(older.title);
  await expect(
    page.getByRole("radio", { name: "タイトルのみ", exact: true }),
  ).toBeChecked();
});

test("automatically searches past an empty first page, appends further batches, and keeps per-article reader authorization", async ({
  page,
}) => {
  await base(page);
  const requests: number[] = [],
    readerScopes: string[] = [];
  const later = article(803, {
    title: "[テスト] さらに昔の記事",
    publishedAt: "2008-03-01T00:00:00Z",
  });
  await page.route("**/api/search**", async (r) => {
    const p = new URL(r.request().url()).searchParams,
      n = Number(p.get("page"));
    requests.push(n);
    expect(p.has("date")).toBe(false);
    if (n > 1) expect(p.get("sources")).toBe("hamusoku");
    await r.fulfill({
      json: {
        ...result(
          p.get("q")!,
          n,
          n === 2 ? [older] : n === 3 ? [newer] : n === 6 ? [later] : [],
          undefined,
          n < 6 ? ["hamusoku"] : [],
        ),
        scope: p.get("scope"),
      },
    });
  });
  await page.route("**/api/reader**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    readerScopes.push(p.get("collection")!);
    return r.fulfill({
      json: readerFixture(p.get("article") === newer.id ? newer : older),
    });
  });
  await page.goto("/");
  await submit(page, "図書館");
  await expect(page.locator(".search-pagination")).toContainText(
    "5ページ分を検索済み",
  );
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  expect(requests).toEqual([1, 2, 3, 4, 5]);
  await expect(page.locator(".search-results-note")).toContainText(
    "2010-03-01",
  );
  await page
    .getByRole("button", { name: `記事を開く: ${newer.title}`, exact: true })
    .click();
  await expect(page.getByRole("region", { name: "記事本文" })).toBeVisible();
  await page.getByRole("button", { name: "次の記事", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(older.title);
  await expect.poll(() => readerScopes.length).toBe(2);
  expect(readerScopes).toEqual([collection(3), collection(2)]);
  await page.getByRole("button", { name: "記事を閉じる", exact: true }).click();
  await page
    .getByRole("button", { name: "さらに過去の記事", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toHaveCount(3);
  await expect(page.locator(".search-results-note")).toContainText(
    "最後のページまで確認",
  );
  expect(requests).toEqual([1, 2, 3, 4, 5, 6]);
});

test("saved and history titles with unknown dates appear in both scopes and stay visible in popular order without fake counts", async ({
  page,
}) => {
  await base(page);
  const saved = article(810, {
    title: "[テスト] 岡田紗佳さんの保存した記事",
    publishedAt: null,
  });
  const history = article(811, {
    title: "[テスト] 岡田紗佳さんの以前の記事",
    publishedAt: null,
  });
  const unrelated = article(812, {
    title: "[テスト] 関係ないおすすめ記事",
    publishedAt: null,
  });
  await page.addInitScript(
    ({ key, prefs }) => localStorage.setItem(key, JSON.stringify(prefs)),
    {
      key: STORAGE_KEY,
      prefs: {
        ...defaults,
        saved: [saved, unrelated],
        history: [{ article: history, at: Date.now() }],
      },
    },
  );
  await page.route("**/api/search**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    return r.fulfill({
      json: { ...result(p.get("q")!, 1, [], {}), scope: p.get("scope") },
    });
  });
  await page.goto("/");
  await submit(page, "岡田紗佳");
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  await expect(page.locator(".search-results-note")).toContainText(
    "保存・履歴のタイトルに一致した記事 2件",
  );
  await page.getByRole("radio", { name: "本文を含む", exact: true }).check();
  await page
    .getByRole("combobox", { name: "記事の並び順" })
    .selectOption("popular");
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  await expect(page.locator(".bookmark-metric")).toHaveCount(0);
  await expect(page.locator(".local-search-label")).toHaveCount(2);
});

test("a later page failure keeps earlier results and retries the same cursor without gaps", async ({
  page,
}) => {
  await base(page);
  const requests: number[] = [];
  let failed = false;
  await page.route("**/api/search**", (r) => {
    const p = new URL(r.request().url()).searchParams,
      n = Number(p.get("page"));
    requests.push(n);
    if (n === 2 && !failed) {
      failed = true;
      return r.fulfill({ status: 503, json: { error: "down" } });
    }
    return r.fulfill({
      json: result(
        p.get("q")!,
        n,
        n === 1 ? [newer] : [older],
        undefined,
        n === 1 ? ["hamusoku"] : [],
      ),
    });
  });
  await page.goto("/");
  await submit(page, "図書館");
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "表示済みの記事は残しています" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "さらに過去の記事", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  expect(requests).toEqual([1, 2, 2]);
});
