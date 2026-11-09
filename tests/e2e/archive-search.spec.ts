import { defaults, STORAGE_KEY } from "../../src/lib/storage";
import { test, expect } from "@playwright/test";
import { feed, article, readerFixture } from "../fixtures";
const fresh = article(881, {
  title: "美脚の新しい記事",
  publishedAt: "2026-11-01T00:00:00Z",
});
const old = article(882, {
  title: "美脚の過去記事",
  publishedAt: "2010-01-03T00:00:00Z",
});
const coll = "search:" + "e".repeat(64);
const response = (q: string, as = [fresh]) => ({
  ...feed,
  query: q,
  scope: "title",
  page: 1,
  collection: "search:" + "d".repeat(64),
  articles: as,
  bookmarks: {},
  nextSources: [],
  candidateCount: as.length,
  excludedCount: 0,
  unverifiedCount: 0,
});
test("continues from keyword search into older public archives and authorizes the additional story", async ({
  page,
}) => {
  await page.route(/\/api\/yahoo(?:-topics)?(?:\?|$)/, (r) => r.abort());
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  const requests: string[] = [];
  let readerCollection = "";
  await page.route("**/api/search?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    const q = p.get("q")!;
    if (!p.has("archive")) return r.fulfill({ json: response(q) });
    requests.push(p.get("cursor") || "start");
    const last = p.has("cursor");
    return r.fulfill({
      json: {
        ...response(q, last ? [old] : []),
        collection: coll,
        archive: {
          cursor: last ? null : "2010-01:1:1",
          month: last ? "2010-01" : "2026-11",
          complete: last,
          failed: false,
          from: "2005-01-01",
          to: "2026-11-09",
          pages: 2,
        },
      },
    });
  });
  await page.route("**/api/reader?**", (r) => {
    readerCollection =
      new URL(r.request().url()).searchParams.get("collection") || "";
    return r.fulfill({ json: readerFixture(old) });
  });
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true })
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "記事を検索" }).fill("美脚");
  await page
    .getByRole("region", { name: "記事を探す", exact: true })
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "検索を続ける", exact: true }),
  ).toBeDisabled();
  expect(requests).toEqual(["start", "2010-01:1:1"]);
  await page.getByRole("button", { name: `記事を開く: ${old.title}` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(readerCollection).toBe(coll);
});

test("large archive results stay available in pages of 100", async ({
  page,
}) => {
  const rows = Array.from({ length: 110 }, (_, i) =>
    article(2000 + i, {
      title: `美脚 ${String.fromCodePoint(0x4e00 + i)}の話`,
      publishedAt: "2020-01-01T00:00:00Z",
    }),
  );
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: { ...defaults, groupSimilar: false } },
  );
  await page.route(/\/api\/yahoo(?:-topics)?(?:\?|$)/, (r) => r.abort());
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/search?**", (r) => {
    const p = new URL(r.request().url()).searchParams;
    return r.fulfill({
      json: {
        ...response(p.get("q")!, p.has("archive") ? rows : []),
        candidateCount: p.has("archive") ? 110 : 0,
        ...(p.has("archive")
          ? {
              archive: {
                cursor: null,
                month: "2005-01",
                complete: true,
                failed: false,
                from: "2005-01-01",
                to: "2026-11-09",
                pages: 2,
              },
            }
          : {}),
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await page
    .getByRole("navigation", {
      name: /メインナビゲーション|下部ナビゲーション/,
    })
    .filter({ visible: true })
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "記事を検索" }).fill("美脚");
  await page
    .getByRole("region", { name: "記事を探す", exact: true })
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await expect(page.getByTestId("article-row")).toHaveCount(100);
  await page.getByRole("button", { name: "次の100件", exact: true }).click();
  await expect(page.getByTestId("article-row")).toHaveCount(10);
  await expect(
    page.getByRole("button", { name: "前の100件", exact: true }),
  ).toBeEnabled();
});
