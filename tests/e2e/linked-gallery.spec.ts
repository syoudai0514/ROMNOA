import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { feed } from "../fixtures";
import { yahooCategories } from "../../src/lib/yahoo-model";
import {
  YahooPhotoService,
  MemoryPhotoCache,
  handleYahooPhotos,
} from "../../server/yahoo-photos";

const article =
  "https://news.yahoo.co.jp/articles/9c75d81a0fc9e868b2cfe97cd9e6b278b2b6bcd1";
const feature = "https://www.crank-in.net/gallery/news/192811/2";
test("linked three-page gallery starts at photo 2 and never includes recommendation cards", async ({
  page,
}) => {
  const engine = new YahooPhotoService(new MemoryPhotoCache(), async (url) => {
    if (url === article)
      return `<script>window.__PRELOADED_STATE__=${JSON.stringify({
        articleDetail: {
          contentId: article.split("/").pop(),
          newsLink: article,
          paragraphs: [
            {
              textDetails: [
                {
                  link: {
                    linkText: "【写真】私服ショット公開",
                    linkURL: feature,
                  },
                },
              ],
            },
          ],
        },
      })}</script>`;
    return readFileSync(
      new URL(
        `../fixtures/crank-gallery-${url.split("/").pop()}.html`,
        import.meta.url,
      ),
      "utf8",
    );
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/articles", (r) => r.fulfill({ json: feed }));
  await page.route("**/api/yahoo", (r) =>
    r.fulfill({
      json: {
        articles: [
          {
            id: article,
            url: article,
            title: "岡田紗佳の写真",
            summary: "テスト記事",
            category: "entertainment",
            publishedAt: null,
            origin: "search",
            image: null,
          },
        ],
        sources: yahooCategories.map((c) => ({
          id: c.id,
          status: "ok",
          fetchedAt: new Date().toISOString(),
        })),
        generatedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/yahoo-photos?**", async (r) => {
    const res = await handleYahooPhotos(
      new Request(r.request().url()),
      engine,
      true,
    );
    await r.fulfill({
      status: res.status,
      body: await res.text(),
      contentType: "application/json",
    });
  });
  const image = await sharp({
    create: { width: 627, height: 984, channels: 3, background: "#849999" },
  })
    .png()
    .toBuffer();
  await page.route("**/api/yahoo-photo-image?**", async (r) => {
    const p = new URL(r.request().url()).searchParams;
    await engine.imageSource(
      p.get("article")!,
      p.get("feature")!,
      p.get("page")!,
      p.get("size") === "thumb",
    );
    await r.fulfill({ body: image, contentType: "image/png" });
  });
  await page.goto("/");
  await page
    .getByRole("group", { name: "配信チャンネル" })
    .getByRole("button", { name: "ニュース", exact: true })
    .click();
  await page.getByRole("button", { name: "新着ニュース", exact: true }).click();
  await page
    .getByRole("button", {
      name: "ニュースを開く: 岡田紗佳の写真",
      exact: true,
    })
    .click();
  const region = page.getByRole("region", {
    name: "写真特集の写真",
    exact: true,
  });
  await expect(region).toContainText("2 / 3");
  await expect(
    region
      .getByRole("group", { name: "写真特集の写真一覧" })
      .getByRole("button"),
  ).toHaveCount(3);
  await expect(region.locator(".photo-feature-stage img")).toHaveJSProperty(
    "naturalWidth",
    627,
  );
  await region
    .getByRole("button", { name: "写真特集の前の写真", exact: true })
    .click();
  await expect(region).toContainText("1 / 3");
  await expect(
    region.getByRole("button", { name: "写真特集の前の写真", exact: true }),
  ).toBeDisabled();
  await region
    .getByRole("button", { name: "写真特集の3枚目を表示", exact: true })
    .click();
  await expect(region).toContainText("3 / 3");
  await expect(region.locator(".photo-feature-stage img")).toHaveAttribute(
    "src",
    /page=https%3A%2F%2Fwww.crank-in.net%2Fgallery%2Fnews%2F192811%2F3/,
  );
  await expect(
    region.getByRole("button", { name: "写真特集の次の写真", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
