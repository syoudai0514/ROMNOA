import { test, expect, type Page } from "@playwright/test";
import { article, feed, readerFixture } from "../fixtures";
import { defaults } from "../../src/lib/storage";

async function fixture(page: Page) {
  await page.route("**/api/reader**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("article");
    const article = feed.articles.find((a) => a.id === id);
    return route.fulfill(
      article
        ? { json: readerFixture(article) }
        : { status: 404, json: { error: "記事がありません" } },
    );
  });
  await page.route("**/api/articles", (route) => route.fulfill({ json: feed }));
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
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
  await expect(reader.getByRole("region", { name: "記事本文" })).toBeVisible();
  await expect(
    reader.getByText(
      "[テスト用本文] 1 本文をアプリ内で読めます。元サイトへ移動せずに、話題の内容を確認するための文章です。",
      { exact: true },
    ),
  ).toBeVisible();
  await reader.getByText("配信元のページを開く", { exact: true }).click();
  await expect(
    reader.getByText("外部サイトが開きます。広告が表示される場合があります。"),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: /^元の記事を読む/ }),
  ).toHaveAttribute("href", feed.articles[0].url);
  await expect(
    reader.getByRole("link", { name: /^元の記事を読む/ }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await reader.getByRole("button", { name: "あとで読む" }).click();
  await expect(
    reader.getByRole("button", { name: "保存済み" }),
  ).toHaveAttribute("aria-pressed", "true");
  await reader.getByRole("button", { name: "次の記事" }).click();
  await expect(reader.getByRole("heading", { level: 1 })).toContainText("料理");
  await reader.getByRole("button", { name: "記事を閉じる" }).click();
  await page.reload();
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
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
  await nav(page).getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("searchbox", { name: "記事を検索" }).fill("休日の料理");
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await page.getByRole("button", { name: "検索をクリア" }).click();
  await nav(page).getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByTestId("home-filters").locator("summary").click();
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
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
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
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
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
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
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
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
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
  await expect(page.getByRole("region", { name: "記事本文" })).toBeVisible();
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

test("article shows selected images first, escapes text and never opens the source automatically", async ({
  page,
}) => {
  await fixture(page);
  const a = feed.articles[0];
  const picture = "https://livedoor.blogimg.jp/hamusoku/imgs/1/2/test.jpg";
  await page.route("**/api/reader**", (route) =>
    route.fulfill({
      json: {
        ...readerFixture(a),
        blocks: [
          {
            type: "text",
            text: 'これはアプリ内の本文です。<img src="https://ads.invalid/pixel" onerror="alert(1)">',
          },
          { type: "image", url: picture, alt: "記事の写真" },
        ],
      },
    }),
  );
  await page.route(picture, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6U5cAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  const outside: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).hostname !== "127.0.0.1") outside.push(r.url());
  });
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const body = page.getByRole("region", { name: "記事本文" });
  await expect(body).toBeVisible();
  await expect(
    body.getByRole("img", { name: "記事の写真", exact: true }),
  ).toBeVisible();
  await expect(body.locator("iframe,script,video")).toHaveCount(0);
  await expect(body).not.toContainText("これはアプリ内の本文です。");
  await page.getByRole("button", { name: "本文も読む", exact: true }).click();
  await expect(body).toContainText("これはアプリ内の本文です。");
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  await expect(
    page.getByRole("link", { name: /^元の記事を読む/ }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "元ページを開く", exact: true }),
  ).toBeVisible();
  await expect(body.getByRole("img", { name: "記事の写真" })).toBeVisible();
  await expect.poll(() => outside.length).toBe(1);
  expect(outside[0]).toBe(picture);
});

test("cached body survives reload and works offline; uncached failures never redirect", async ({
  page,
  context,
}) => {
  await fixture(page);
  let reads = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/reader") reads++;
  });
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("region", { name: "記事本文" })).toBeVisible();
  await page.getByRole("button", { name: "記事を閉じる" }).click();
  await page.reload();
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await expect(page.getByTestId("article-row").first()).toBeVisible();
  await page.unroute("**/api/reader**");
  await context.setOffline(true);
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("region", { name: "記事本文" })).toBeVisible();
  expect(reads).toBe(1);
  await page.getByRole("button", { name: "記事を閉じる" }).click();
  await page
    .getByTestId("article-row")
    .nth(1)
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "本文を読み込めませんでした" }),
  ).toBeVisible();
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
});

test("image gallery expands, moves between images, and returns focus to the article", async ({
  page,
}) => {
  await fixture(page);
  const pictures = ["first", "second"].map(
    (name) => `https://livedoor.blogimg.jp/hamusoku/imgs/1/2/${name}.jpg`,
  );
  await page.route("https://livedoor.blogimg.jp/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="500"><rect width="600" height="500" fill="#789c8b"/></svg>',
    }),
  );
  await page.route("**/api/reader**", (route) =>
    route.fulfill({
      json: {
        ...readerFixture(feed.articles[0]),
        blocks: pictures.map((url, i) => ({
          type: "image",
          url,
          alt: `記事写真${i + 1}`,
        })),
        imageAudit: { excluded: 3, uncertain: 1, related: 2 },
      },
    }),
  );
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(
    page
      .getByRole("region", { name: "この記事の画像" })
      .getByRole("group", { name: "記事の写真一覧" })
      .getByRole("button"),
  ).toHaveCount(2);
  await page.getByText("画像の判定について", { exact: true }).click();
  await expect(page.getByText(/判定保留：1枚非表示/)).toBeVisible();
  await page
    .getByRole("button", { name: "記事写真1を拡大", exact: true })
    .click();
  const viewer = page.getByRole("dialog", { name: "記事画像の拡大表示" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute("src", pictures[0]);
  await expect(viewer.getByRole("button", { name: "前の画像" })).toBeDisabled();
  await viewer.getByRole("button", { name: "次の画像" }).click();
  await expect(viewer.locator("img")).toHaveAttribute("src", pictures[1]);
  await viewer.getByRole("button", { name: "拡大画像を閉じる" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByRole("heading", { level: 1 }),
  ).toBeVisible();
  // The article gallery keeps the photo chosen in the viewer.
  await expect(
    page.getByRole("button", { name: "記事写真2を拡大", exact: true }),
  ).toBeFocused();
});

test("follows two related articles outside the feed, saves them, and restores the parent reading position", async ({
  page,
}) => {
  await fixture(page);
  const first = feed.articles[0];
  const second = article(70, { title: "[テスト用] 別の記事の写真まとめ" });
  const third = article(71, { title: "[テスト用] さらに次の画像まとめ" });
  const requests: { id: string | null; from: string | null }[] = [];
  await page.route("**/api/reader**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push({ id: params.get("article"), from: params.get("from") });
    const current = [first, second, third].find(
      (a) => a.id === params.get("article"),
    )!;
    const next =
      current.id === first.id
        ? second
        : current.id === second.id
          ? third
          : null;
    return route.fulfill({
      json: {
        ...readerFixture(current),
        related: next ? [{ article: next, thumbnail: null }] : [],
      },
    });
  });
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const related = page.getByRole("region", { name: "ほかのまとめ" });
  await related.getByRole("button", { name: /別の記事の写真まとめ/ }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { level: 1 }),
  ).toHaveText(second.title);
  await page.getByRole("button", { name: "あとで読む", exact: true }).click();
  await related.getByRole("button", { name: /さらに次の画像まとめ/ }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { level: 1 }),
  ).toHaveText(third.title);
  await page
    .getByRole("button", { name: "元の記事へ戻る", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { level: 1 }),
  ).toHaveText(second.title);
  await page
    .getByRole("button", { name: "元の記事へ戻る", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { level: 1 }),
  ).toHaveText(first.title);
  await expect
    .poll(() => page.locator(".reader-content").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  expect(requests).toEqual([
    { id: first.id, from: null },
    { id: second.id, from: first.id },
    { id: third.id, from: second.id },
  ]);
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  await page.getByRole("button", { name: "記事を閉じる", exact: true }).click();
  await page.reload();
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await nav(page).getByRole("button", { name: /^保存/ }).click();
  await expect(
    page.getByTestId("article-row").getByText(second.title, { exact: true }),
  ).toBeVisible();
});

test("Pickup title opens its real story with X photos; original-page and body links actually navigate", async ({
  page,
  context,
}) => {
  await fixture(page);
  const first = feed.articles[0];
  const story = article(90, { title: "[テスト用] 写真が載っている本編" });
  const external = "https://example.com/romnoa-source";
  const photos = ["PhotoA", "PhotoB"].map(
    (name) => `https://pbs.twimg.com/media/${name}.jpg`,
  );
  await context.route("https://hamusoku.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Original page fixture</h1>",
    }),
  );
  await context.route(external, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Body link destination fixture</h1>",
    }),
  );
  await page.route("https://pbs.twimg.com/media/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="#759685"/></svg>',
    }),
  );
  await page.route("**/api/reader**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("article");
    return route.fulfill({
      json:
        id === first.id
          ? {
              ...readerFixture(first),
              pageKind: "roundup",
              related: [{ article: story, thumbnail: null }],
              blocks: [{ type: "text", text: "紹介一覧です。" }],
            }
          : {
              ...readerFixture(story),
              links: [{ url: external, title: "写真の投稿元はこちら" }],
              blocks: [
                {
                  type: "image",
                  url: "https://livedoor.blogimg.jp/hamusoku/imgs/1/2/cover.jpg",
                  alt: "見出し用の紹介画像",
                  role: "cover",
                },
                ...photos.map((url, i) => ({
                  type: "image",
                  url,
                  alt: `本編写真${i + 1}`,
                })),
                {
                  type: "text",
                  text: "写真の投稿元はこちら。クリックすると元のページを開きます。",
                },
              ],
            },
    });
  });
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const reader = page.getByRole("dialog");
  await expect(
    reader.getByText("記事への案内ページです", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("region", { name: "この記事の画像", exact: true }),
  ).toHaveCount(0);
  await reader.getByRole("button", { name: /写真が載っている本編/ }).click();
  await expect(reader.getByRole("heading", { level: 1 })).toHaveText(
    story.title,
  );
  const gallery = reader.getByRole("region", {
    name: "この記事の画像",
    exact: true,
  });
  await expect(
    gallery.getByRole("group", { name: "記事の写真一覧" }).getByRole("button"),
  ).toHaveCount(2);
  await expect(
    gallery.getByRole("img", { name: "本編写真1", exact: true }),
  ).toBeVisible();
  await expect(
    gallery.getByRole("img", { name: "見出し用の紹介画像", exact: true }),
  ).toHaveCount(0);
  const opened = page.waitForEvent("popup");
  await reader
    .getByRole("link", { name: "元ページを開く", exact: true })
    .click();
  const original = await opened;
  await original.waitForURL(story.url);
  await expect(original.getByRole("heading")).toHaveText(
    "Original page fixture",
  );
  await original.close();
  await reader.getByRole("button", { name: "本文も読む", exact: true }).click();
  const linked = page.waitForEvent("popup");
  await reader
    .getByRole("link", { name: "写真の投稿元はこちら", exact: true })
    .click();
  const destination = await linked;
  await destination.waitForURL(external);
  await expect(destination.getByRole("heading")).toHaveText(
    "Body link destination fixture",
  );
  await destination.close();
});

test("Imgur photos load without a body toggle, and inline image/article clicks stay in the app", async ({
  page,
}) => {
  await fixture(page);
  const first = feed.articles[0];
  const next = article(92, { title: "[テスト用] 次の画像まとめ" });
  const originals = ["PhotoA1", "PhotoB2", "PhotoC3"].map(
    (id) => `https://imgur.com/${id}.jpg`,
  );
  const photos = originals.map((url) =>
    url.replace("https://imgur.com/", "https://i.imgur.com/"),
  );
  const requests: string[] = [];
  let popups = 0;
  page.on("popup", () => popups++);
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      requests.push(request.url());
  });
  await page.route("https://i.imgur.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="600" height="750" fill="#759685"/></svg>',
    }),
  );
  await page.route("**/api/reader**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("article") === next.id) {
      expect(params.get("from")).toBe(first.id);
      return route.fulfill({ json: readerFixture(next) });
    }
    return route.fulfill({
      json: {
        ...readerFixture(first),
        related: [{ article: next, thumbnail: null }],
        links: [
          ...originals.map((url) => ({
            url: url.replace(/\.jpg$/, ""),
            title: url,
          })),
          { url: next.url, title: "次の画像まとめ" },
        ],
        blocks: [
          {
            type: "image",
            url: "https://livedoor.blogimg.jp/hamusoku/imgs/1/2/cover.jpg",
            alt: "紹介画像",
            role: "cover",
          },
          ...photos.map((url, i) => ({
            type: "image",
            url,
            alt: `本文写真${i + 1}`,
          })),
          { type: "text", text: originals.join("\n") + "\n次の画像まとめ" },
        ],
      },
    });
  });
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const reader = page.getByRole("dialog");
  const gallery = reader.getByRole("region", {
    name: "この記事の画像",
    exact: true,
  });
  await expect(
    gallery.getByRole("group", { name: "記事の写真一覧" }).getByRole("button"),
  ).toHaveCount(3);
  await expect(gallery.locator("img").first()).toHaveAttribute(
    "loading",
    "eager",
  );
  await expect(gallery.locator("img").first()).toHaveJSProperty(
    "naturalWidth",
    600,
  );
  await expect(
    reader.getByRole("button", { name: "本文も読む", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await reader.getByRole("button", { name: "本文も読む", exact: true }).click();
  const body = reader.getByRole("region", { name: "記事本文", exact: true });
  await expect(body.locator('a[href*="imgur.com"]')).toHaveCount(0);
  await body.getByRole("button", { name: "画像1を拡大", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "記事画像の拡大表示" });
  await expect(viewer.locator("img")).toHaveAttribute("src", photos[0]);
  await viewer.getByRole("button", { name: "拡大画像を閉じる" }).click();
  await body
    .getByRole("button", { name: "次の画像まとめ", exact: true })
    .click();
  await expect(reader.getByRole("heading", { level: 1 })).toHaveText(
    next.title,
  );
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  expect(popups).toBe(0);
  expect(requests.every((url) => photos.includes(url))).toBe(true);
});

test("reader keeps bottom navigation available and returns to the selected tab", async ({
  page,
  isMobile,
}) => {
  await fixture(page);
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const reader = page.getByRole("dialog");
  await expect(
    reader.getByRole("button", { name: "記事を閉じる" }),
  ).toBeVisible();
  if (isMobile) {
    const nav = reader.getByRole("navigation", {
      name: "記事内のナビゲーション",
    });
    await expect(nav).toBeVisible();
    await nav.getByRole("button", { name: "検索", exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "下部ナビゲーション" })
        .getByRole("button", { name: "検索", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("roundup article shows embedded post videos alongside body images", async ({
  page,
}) => {
  await fixture(page);
  const first = feed.articles[0];
  const postUrl = "https://x.com/mico_bodymake/status/2068315106715558288";
  const videoUrl =
    "https://video.twimg.com/amplify_video/2068315032430292992/vid/avc1/720x1280/47w7K5GDfrEreJDG.mp4";
  await page.route("**/api/reader**", (route) =>
    route.fulfill({
      json: {
        ...readerFixture(first),
        links: [{ url: postUrl, title: "Xの投稿" }],
        blocks: [
          {
            type: "image",
            url: "https://livedoor.blogimg.jp/hamusoku/imgs/1/2/photo.jpg",
            alt: "本文の画像",
          },
          { type: "text", text: "記事本文" },
        ],
      },
    }),
  );
  await page.route("**/api/social**", (route) =>
    route.fulfill({
      json: {
        provider: "X",
        url: postUrl,
        author: "mico",
        handle: "mico_bodymake",
        text: "投稿本文",
        createdAt: "2026-06-20T12:48:43.000Z",
        media: [
          {
            type: "video",
            url: videoUrl,
            poster:
              "https://pbs.twimg.com/amplify_video_thumb/2068315032430292992/img/MsoGhDal4DL8y-9J.jpg",
          },
        ],
      },
    }),
  );
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const reader = page.getByRole("dialog");
  await expect(
    reader.getByRole("region", { name: "この記事の画像", exact: true }),
  ).toBeVisible();
  const post = reader.getByRole("region", { name: "Xの投稿 @mico_bodymake" });
  await expect(post).toBeVisible();
  await expect(post.locator("video")).toHaveAttribute("src", videoUrl);
  await expect(post.locator("video")).toHaveAttribute("controls", "");
});

test("saved roundup articles switch between save order and publication date", async ({
  page,
}) => {
  await fixture(page);
  for (const a of feed.articles.slice(0, 2)) {
    await page.getByRole("button", { name: `保存する: ${a.title}` }).click();
  }
  await nav(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("article-row").first()).toContainText(
    feed.articles[1].title,
  );
  await page.getByLabel("保存した記事の並び順").selectOption("date");
  await expect(page.getByTestId("article-row").first()).toContainText(
    feed.articles[0].title,
  );
  await page.getByLabel("保存した記事の並び順").selectOption("saved");
  await expect(page.getByTestId("article-row").first()).toContainText(
    feed.articles[1].title,
  );
});

test("transfers roundup and news favorites into existing libraries", async ({
  page,
}) => {
  await fixture(page);
  const sourceArticle = feed.articles[0];
  const yahoo = {
    id: `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`,
    url: `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`,
    title: "ニュースの保存記事",
    summary: "",
    image: null,
    category: "domestic",
    publishedAt: null,
  };
  await page.evaluate(
    ({ sourceArticle, yahoo, initialDefaults }) => {
      const raw = JSON.parse(
        localStorage.getItem("romnoa:preferences:v1") ||
          JSON.stringify(initialDefaults),
      );
      localStorage.setItem(
        "romnoa:preferences:v1",
        JSON.stringify({ ...raw, saved: [sourceArticle] }),
      );
      localStorage.setItem(
        "romnoa:yahoo-library:v1",
        JSON.stringify({ saved: [yahoo], read: {} }),
      );
    },
    { sourceArticle, yahoo, initialDefaults: defaults },
  );
  await page.reload();
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await nav(page).getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "引き継ぎデータを作成" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "まとめ 1件、ニュース 1件" }),
  ).toBeVisible();
  const exported = await page.getByLabel("作成した引き継ぎデータ").inputValue();
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("romnoa:preferences:v1")!);
    localStorage.setItem(
      "romnoa:preferences:v1",
      JSON.stringify({ ...raw, saved: [] }),
    );
    localStorage.setItem(
      "romnoa:yahoo-library:v1",
      JSON.stringify({ saved: [], read: {} }),
    );
  });
  await page.reload();
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "まとめ", exact: true })
    .click();
  await nav(page).getByRole("button", { name: "設定", exact: true }).click();
  await page.getByLabel("お気に入りの引き継ぎファイル").setInputFiles({
    name: "romnoa-favorites.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported),
  });
  await expect(page.getByLabel("取り込む引き継ぎデータ")).toHaveValue(exported);
  await page.getByRole("button", { name: "お気に入りを取り込む" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "まとめ 1件、ニュース 1件" }),
  ).toBeVisible();
  await nav(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("article-row").first()).toContainText(
    sourceArticle.title,
  );
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "ニュース", exact: true })
    .click();
  await expect(page.getByTestId("yahoo-row").first()).toContainText(
    yahoo.title,
  );
});
