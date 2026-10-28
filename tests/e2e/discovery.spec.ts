import { test, expect } from "@playwright/test";
import { feed, readerFixture, article } from "../fixtures";
import { japanDay, shiftDay } from "../../src/lib/discovery-model";

const past = "2026-10-20";
const first = article(81, {
  title: "[テスト用] 配信元の人気一位",
  publishedAt: "2026-10-19T15:30:00.000Z",
});
const third = article(82, {
  title: "[テスト用] 配信元の人気三位",
  publishedAt: "2026-10-20T03:30:00.000Z",
});
const alpha = article(83, {
  id: "https://alfalfalfa.com/articles/11000083.html",
  url: "https://alfalfalfa.com/articles/11000083.html",
  sourceId: "alfalfa",
  title: "[テスト用] 別サイトの人気一位",
  publishedAt: first.publishedAt,
});
function response(
  mode: "popular" | "date",
  date: string | null,
  articles = [first, third, alpha],
) {
  return {
    ...feed,
    mode,
    date,
    articles,
    ranks:
      mode === "popular"
        ? [
            { id: first.id, rank: 1 },
            { id: third.id, rank: 3 },
            { id: alpha.id, rank: 1 },
          ].filter((r) => articles.some((a) => a.id === r.id))
        : [],
    limitedSources: [],
    generatedAt: new Date().toISOString(),
  };
}

test("source popularity preserves ranks, combines date/search, and opens ranked stories in the reader", async ({
  page,
}) => {
  const readerQueries: string[] = [];
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/discovery**", (r) => {
    const q = new URL(r.request().url()).searchParams;
    return r.fulfill({
      json: response(
        q.get("mode") as "popular" | "date",
        q.get("date"),
        q.has("date") ? [third] : undefined,
      ),
    });
  });
  await page.route("**/api/reader**", (r) => {
    const q = new URL(r.request().url()).searchParams;
    readerQueries.push(q.get("collection") || "");
    const a = [first, third, alpha].find((a) => a.id === q.get("article"))!;
    return r.fulfill({ json: readerFixture(a) });
  });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "記事の並び順" })
    .selectOption("popular");
  await expect(
    page.getByRole("heading", { name: /人気記事（サイト別）/ }),
  ).toBeVisible();
  await expect(page.getByTestId("article-row")).toHaveCount(3);
  await expect(page.locator(".rank-label strong")).toHaveText([
    "1位",
    "3位",
    "1位",
  ]);
  await expect(page.locator(".discovery-note")).toContainText(
    "ハムスター速報：直近1週間",
  );
  await expect(page.getByTestId("article-row").first()).toContainText(
    first.title,
  );
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("[テスト用本文]");
  expect(readerQueries).toEqual(["popular"]);
  await page.getByRole("button", { name: "記事を閉じる", exact: true }).click();
  await page.getByLabel("掲載日", { exact: true }).fill(past);
  await page.getByRole("button", { name: "表示", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.locator(".rank-label strong")).toHaveText(["3位"]);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "過去の人気順位ではありません" }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "記事を検索" })
    .fill("存在しない検索");
  await expect(page.getByTestId("article-row")).toHaveCount(0);
  await page.getByRole("button", { name: "検索をクリア", exact: true }).click();
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText(third.title);
  expect(readerQueries).toEqual(["popular", `date:${past}`]);
});

test("date archive finds older stories, keeps favorites/read, changes day and clears back to latest", async ({
  page,
}) => {
  const queries: string[] = [];
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/discovery**", (r) => {
    const q = new URL(r.request().url()).searchParams;
    queries.push(q.get("date")!);
    return r.fulfill({
      json: response(
        "date",
        q.get("date"),
        q.get("date") === past ? [first] : [],
      ),
    });
  });
  await page.route("**/api/reader**", (r) =>
    r.fulfill({ json: readerFixture(first) }),
  );
  await page.goto("/");
  await page.getByLabel("掲載日", { exact: true }).fill(past);
  await page.getByRole("button", { name: "表示", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.getByTestId("article-row")).toContainText(first.title);
  await page
    .getByRole("button", { name: `保存する: ${first.title}`, exact: true })
    .click();
  await page
    .getByTestId("article-row")
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("[テスト用本文]");
  await page.getByRole("button", { name: "記事を閉じる", exact: true }).click();
  await expect(page.getByTestId("article-row")).toContainText("既読");
  await page.getByRole("button", { name: "前の日", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /2026-10-19の記事/ }),
  ).toBeVisible();
  await expect(page.getByTestId("article-row")).toHaveCount(0);
  await page.getByRole("button", { name: "次の日", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await page.getByRole("button", { name: "日付を解除", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(
    feed.articles.length,
  );
  expect(queries).toContain("2026-10-19");
  await page.reload();
  await page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true })
    .getByRole("button", { name: /^保存/ })
    .click();
  await expect(page.getByTestId("article-row")).toContainText(first.title);
  await expect(page.getByTestId("article-row")).toContainText("既読");
  await expect(
    page
      .getByTestId("article-row")
      .getByRole("button", { name: `保存を解除: ${first.title}`, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("rapid day changes and a failed date never display another date's stories; 375px fits", async ({
  page,
}) => {
  const today = japanDay(),
    yesterday = shiftDay(today, -1);
  let failedLists = false;
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/discovery**", async (r) => {
    const date = new URL(r.request().url()).searchParams.get("date");
    if (failedLists) {
      await r.fulfill({ status: 503, json: { error: "取得できません" } });
      return;
    }
    if (date === today) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await r
        .fulfill({ json: response("date", date, [first]) })
        .catch(() => {});
    } else if (date === yesterday)
      await r.fulfill({ json: response("date", date, [third]) });
    else await r.fulfill({ status: 503, json: { error: "取得できません" } });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await page.getByRole("button", { name: "前の日", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.getByTestId("article-row")).toContainText(third.title);
  await page.getByLabel("掲載日", { exact: true }).fill("2026-01-01");
  await page.getByRole("button", { name: "表示", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "この一覧を取得できませんでした" }),
  ).toBeVisible();
  await expect(page.getByTestId("article-row")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "この一覧を再試行", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  failedLists = true;
  await page.reload();
  await page.getByLabel("掲載日", { exact: true }).fill(yesterday);
  await page.getByRole("button", { name: "表示", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await expect(page.getByTestId("article-row")).toContainText(third.title);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "前回取得した情報を表示しています" }),
  ).toBeVisible();
});
