import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nikkansportsGallery } from "../server/nikkansports-gallery.js";
import { resolvePhotoPage } from "../server/yahoo-photos.js";

const html = readFileSync("tests/fixtures/nikkansports-gallery.html", "utf8");
const page =
  "https://www.nikkansports.com/entertainment/photonews/photonews_nsInc_202610300000325-1.html";

describe("日刊スポーツ photo roster", () => {
  it("extracts all seven article photos in publisher order and the selected full image", async () => {
    const result = await resolvePhotoPage(html, page);
    expect(result.strategy).toBe("nikkansports");
    expect(result.data.complete).toBe(true);
    expect(result.data.pages).toHaveLength(7);
    expect(result.data.pages.map((p) => p.match(/-(\d+)\.html$/)?.[1])).toEqual(
      ["0", "1", "2", "3", "4", "5", "6"],
    );
    expect(result.data.picture.url).toMatch(/-w1300_1\.jpg$/);
    expect(result.data.thumbnails[6].url).toMatch(/-w200_6\.jpg$/);
  });
  it("rejects a thumbnail or selected image from another article", () => {
    expect(() =>
      nikkansportsGallery(
        html.replace("202610300000325-w200_2", "202610300009999-w200_2"),
        page,
      ),
    ).toThrow();
    expect(() =>
      nikkansportsGallery(
        html.replace("202610300000325-w1300_1", "202610300000325-w1300_2"),
        page,
      ),
    ).toThrow();
  });
  it("ignores recommendations outside the article roster", () => {
    const withRelated =
      html +
      '<aside><a href="/entertainment/photonews/photonews_nsInc_202610300009999-0.html"><img src="https://example.com/ad.jpg"></a></aside>';
    expect(nikkansportsGallery(withRelated, page)?.pages).toHaveLength(7);
  });
});
