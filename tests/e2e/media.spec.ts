import { test, expect, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { feed, readerFixture } from "../fixtures";

const mp4 =
  "https://video.twimg.com/amplify_video/2032037106206588929/vid/avc1/720x1002/CZFfVK_dQmbjSAyr.mp4";
test("MP4 actually plays inline and GIF changes frames without external navigation", async ({
  page,
}) => {
  const clip = await readFile("tests/fixtures/playback.mp4");
  const animation = await readFile("tests/fixtures/animation.gif");
  const gif = "https://i.imgur.com/Example.gif";
  const loop = "https://video.twimg.com/tweet_video/AnimTest.mp4";
  // Safari seeks with byte ranges, including for an MP4 animation's next loop.
  const serveClip = (route: Route) => {
    expect(route.request().headers().referer).toBeUndefined();
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2]
      ? Math.min(Number(range[2]), clip.length - 1)
      : clip.length - 1;
    if (start >= clip.length || end < start)
      return route.fulfill({
        status: 416,
        headers: { "content-range": `bytes */${clip.length}` },
      });
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "video/mp4",
      headers: {
        "accept-ranges": "bytes",
        ...(range
          ? { "content-range": `bytes ${start}-${end}/${clip.length}` }
          : {}),
      },
      body: clip.subarray(start, end + 1),
    });
  };
  let popups = 0;
  const outside: string[] = [];
  const errors: string[] = [];
  page.on("popup", () => popups++);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    // WebKit's native controls use blob: URLs with the app's own origin.
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173")
      outside.push(request.url());
  });
  await page.route(mp4, serveClip);
  await page.route(loop, serveClip);
  await page.route(gif, (route) =>
    route.fulfill({ contentType: "image/gif", body: animation }),
  );
  await page.route("**/api/articles", (route) => route.fulfill({ json: feed }));
  await page.route("**/api/reader**", (route) =>
    route.fulfill({
      json: {
        ...readerFixture(feed.articles[0]),
        links: [
          { url: mp4, title: mp4 },
          { url: gif, title: gif },
          { url: loop, title: loop },
        ],
        blocks: [{ type: "text", text: `${mp4}\n${gif}\n${loop}` }],
      },
    }),
  );
  await page.goto("/");
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const reader = page.getByRole("dialog");
  await expect(
    reader.getByRole("region", { name: "この記事の動画", exact: true }),
  ).toBeVisible();
  const player = reader.getByLabel("記事内の動画 1", { exact: true });
  await expect(player).toHaveAttribute("playsinline", "");
  await expect(player).toHaveAttribute("controls", "");
  await expect
    .poll(() =>
      player.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await reader.getByRole("button", { name: "本文も読む", exact: true }).click();
  const body = reader.getByRole("region", { name: "記事本文", exact: true });
  await expect(body.locator('a[href*="video.twimg.com"]')).toHaveCount(0);
  await body.getByRole("button", { name: "動画1を再生", exact: true }).click();
  await expect
    .poll(() =>
      player.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0.05);
  await player.evaluate((element: HTMLVideoElement) => element.pause());
  await expect(player).toHaveJSProperty("paused", true);
  const looping = reader.getByLabel("記事内の動画 2", { exact: true });
  await expect(looping).toHaveJSProperty("loop", true);
  await expect(looping).toHaveJSProperty("muted", true);
  await body.getByRole("button", { name: "動画2を再生", exact: true }).click();
  await expect
    .poll(() =>
      looping.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0.05);
  await looping.evaluate((element: HTMLVideoElement) => element.pause());
  const image = reader
    .getByRole("region", { name: "この記事の画像", exact: true })
    .locator("img");
  await expect(image).toHaveJSProperty("naturalWidth", 48);
  await image.scrollIntoViewIfNeeded();
  // Locator screenshots wait for layout stability, which can alias a short GIF's
  // frame period. Capture its fixed viewport rectangle without that wait.
  const clipBox = (await image.boundingBox())!;
  const frame = await page.screenshot({ clip: clipBox });
  await expect
    .poll(
      async () => !(await page.screenshot({ clip: clipBox })).equals(frame),
      {
        intervals: [73, 131, 197],
      },
    )
    .toBe(true);
  expect(popups).toBe(0);
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  expect(errors).toEqual([]);
  expect(outside.every((url) => [mp4, gif, loop].includes(url))).toBe(true);
});

test("Instagram CDN photos render without a widget; post-only URLs get an explicit fallback", async ({
  page,
}) => {
  const image =
    "https://scontent-nrt1-1.cdninstagram.com/v/t51.2885-15/123456_n.jpg?oh=public_signature&oe=1234";
  const post = "https://www.instagram.com/p/AbCdEfg/";
  await page.route("**/api/social?**", (route) =>
    route.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  const outside: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      outside.push(request.url());
  });
  await page.route(image, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6U5cAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/articles", (route) => route.fulfill({ json: feed }));
  await page.route("**/api/reader**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("article");
    const article = feed.articles.find((candidate) => candidate.id === id)!;
    return route.fulfill({
      json: {
        ...readerFixture(article),
        links: [{ url: post, title: "Instagramの投稿" }],
        blocks:
          id === feed.articles[0].id
            ? [{ type: "image", url: image, alt: "Instagramの公開画像" }]
            : [{ type: "text", text: "Instagramの投稿" }],
      },
    });
  });
  await page.goto("/");
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const reader = page.getByRole("dialog");
  await expect(
    reader.getByRole("img", { name: "Instagramの公開画像", exact: true }),
  ).toBeVisible();
  await reader.getByRole("button", { name: "次の記事", exact: true }).click();
  const fallback = reader.getByRole("region", {
    name: "SNSの投稿",
    exact: true,
  });
  // The post itself could not be read here, so the card offers the app.
  await expect(fallback).toContainText("投稿を表示できませんでした");
  await expect(
    fallback.getByRole("link", { name: /Instagramで開く/ }),
  ).toHaveAttribute("href", post);
  await expect(reader.locator("iframe,script")).toHaveCount(0);
  expect(outside).toEqual([image]);
});

test("a missing MP4 shows a recoverable error and retry plays without navigating", async ({
  page,
}) => {
  const clip = await readFile("tests/fixtures/playback.mp4");
  let attempts = 0;
  let popups = 0;
  page.on("popup", () => popups++);
  await page.route(mp4, (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ contentType: "video/mp4", body: clip });
  });
  await page.route("**/api/articles", (route) => route.fulfill({ json: feed }));
  await page.route("**/api/reader**", (route) =>
    route.fulfill({
      json: {
        ...readerFixture(feed.articles[0]),
        links: [{ url: mp4, title: mp4 }],
        blocks: [{ type: "text", text: mp4 }],
      },
    }),
  );
  await page.goto("/");
  await page
    .getByTestId("article-row")
    .first()
    .getByRole("button", { name: /^記事を開く/ })
    .click();
  const reader = page.getByRole("dialog");
  await expect(reader.getByRole("status")).toContainText(
    "この動画を再生できませんでした",
  );
  await reader.getByRole("button", { name: "本文も読む", exact: true }).click();
  await reader
    .getByRole("button", { name: "動画1を再生", exact: true })
    .click();
  await expect(reader).toContainText("プレーヤーの再読み込みをお試しください");
  await reader
    .getByRole("button", { name: "動画を再読み込み", exact: true })
    .click();
  const player = reader.getByLabel("記事内の動画 1", { exact: true });
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await reader
    .getByRole("button", { name: "動画1を再生", exact: true })
    .click();
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.05);
  expect(attempts).toBeGreaterThanOrEqual(2);
  expect(popups).toBe(0);
  expect(new URL(page.url()).origin).toBe("http://127.0.0.1:4173");
});
