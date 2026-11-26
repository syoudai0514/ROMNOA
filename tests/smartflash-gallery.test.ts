import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { MemoryPhotoCache, YahooPhotoService } from "../server/yahoo-photos";
import { smartFlashGallery } from "../server/smartflash-gallery";

const article =
  "https://news.yahoo.co.jp/articles/861e83ed87a8f88585feef3fea904569e8be822d";
const feature =
  "https://smart-flash.jp/entertainment/entertainment-news/437878/image/1/";
const html = readFileSync(
  new URL("./fixtures/smartflash-gallery.html", import.meta.url),
  "utf8",
);

it("displays the nine declared slides and serves their images without requesting unlisted pages", async () => {
  const metadata = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({
    articleDetail: {
      contentId: article.split("/").pop(),
      newsLink: article,
      paragraphs: [
        {
          textDetails: [
            { link: { linkText: "【画像あり】衣装を披露", linkURL: feature } },
          ],
        },
      ],
    },
  })};</script>`;
  const load = vi.fn(async (url: string) => {
    if (url === article) return metadata;
    if (url === feature) return html;
    throw Error("unexpected photo page");
  });
  const service = new YahooPhotoService(new MemoryPhotoCache(), load);
  const gallery = await service.get(article, feature);
  expect(gallery).toMatchObject({ kind: "gallery", complete: true });
  if (gallery.kind !== "gallery") throw Error("expected gallery");
  expect(
    gallery.thumbnails.map(({ url }) => new URL(url).pathname.split("/").pop()),
  ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 1].map((n) => `enako${n}_1.jpg`));
  expect(gallery.picture.caption).toBe(
    "日本神話をテーマにした豪華なコスプレ姿を披露したえなこ",
  );
  expect(await service.get(article, feature, gallery.pages[8])).toMatchObject({
    picture: { caption: "壇上でマイクを持つえなこ" },
  });
  await expect(
    service.imageSource(article, feature, gallery.pages[8], false),
  ).resolves.toEqual({
    url: gallery.thumbnails[8].url,
    referer: feature,
  });
  await expect(
    service.imageSource(article, feature, `${feature}#romnoa-photo-10`, false),
  ).rejects.toThrow("page_not_linked");
  expect(load.mock.calls).toEqual([[article], [feature]]);
});

it("selects the linked ordinal and rejects a partial or unrelated carousel", () => {
  const third = feature.replace(/1\/$/, "3/");
  expect(smartFlashGallery(html, third)?.picture.url).toMatch(/enako4_1\.jpg$/);
  expect(
    smartFlashGallery(html.replace("9/9</p>", "9/10</p>"), feature),
  ).toBeNull();
  expect(
    smartFlashGallery(html.replace('id="main"', 'id="related"'), feature),
  ).toBeNull();
});
