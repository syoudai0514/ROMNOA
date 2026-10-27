import { chromium, expect } from "@playwright/test";
import { preview } from "vite";
import { feed, readerFixture } from "../tests/fixtures";

// Exercise the built app and real service worker, separately from dev-server E2E.
const server = await preview({
  preview: { port: 4174, strictPort: true, host: "127.0.0.1" },
});
const browser = await chromium.launch(
  process.env.PW_SYSTEM_CHROMIUM ? { executablePath: "/usr/bin/chromium" } : {},
);
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/articles", (route) => route.fulfill({ json: feed }));
  await page.route("**/api/reader**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("article");
    const article = feed.articles.find((a) => a.id === id);
    return route.fulfill(
      article
        ? { json: readerFixture(article) }
        : { status: 404, json: { error: "missing" } },
    );
  });
  await page.goto("http://127.0.0.1:4174/");
  await expect(page.getByTestId("article-row").first()).toBeVisible();
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("region", { name: "記事本文" })).toBeVisible();
  await page.getByRole("button", { name: "あとで読む" }).click();
  await page.getByRole("button", { name: "記事を閉じる" }).click();
  const manifestUrl = await page
    .locator("link[rel=manifest]")
    .getAttribute("href");
  const manifest = await (
    await context.request.get(`http://127.0.0.1:4174${manifestUrl}`)
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.lang).toBe("ja");
  expect(manifest.start_url).toBe("/");
  for (const icon of manifest.icons) {
    expect(
      (await context.request.get(`http://127.0.0.1:4174${icon.src}`)).ok(),
    ).toBe(true);
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  expect(
    await page.evaluate(async () => !!(await caches.match("/api/articles"))),
  ).toBe(false);
  await page.unroute("**/api/articles");
  await page.unroute("**/api/reader**");
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText(
      "オフラインです。端末に残っている記事と保存内容を表示します。",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("article-row").first()).toBeVisible();
  await page
    .getByRole("navigation", { name: "下部ナビゲーション" })
    .getByRole("button", { name: /^保存/ })
    .click();
  await expect(page.getByTestId("article-row")).toHaveCount(1);
  await page
    .getByTestId("article-row")
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  await expect(page.getByRole("region", { name: "記事本文" })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PWA PASS: built shell + manifest + icons + real SW + offline reload + persistent favorite + offline reader body (API mocks removed); no page errors.",
  );
  await context.close();
} finally {
  await browser.close();
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}
