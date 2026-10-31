import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dailyGallery } from "../server/daily-gallery.js";
import { resolvePhotoPage } from "../server/yahoo-photos.js";

const html = readFileSync("tests/fixtures/daily-gallery.html", "utf8");
const page = "https://www.daily.co.jp/gossip/2026/10/25/0020964686.shtml?ph=2";

describe("Daily photo roster", () => {
  it("extracts all five publisher photo pages in order with the selected full-size photo", async () => {
    const result = await resolvePhotoPage(html, page);
    expect(result.strategy).toBe("daily");
    expect(result.data.complete).toBe(true);
    expect(
      result.data.pages.map((p) => new URL(p).searchParams.get("ph")),
    ).toEqual(["1", "2", "3", "4", "5"]);
    expect(result.data.picture.url).toMatch(/\/f_20964688\.jpg$/);
    expect(result.data.thumbnails[1].url).toMatch(/\/b_20964688\.jpg$/);
  });
  it("rejects unrelated thumbnails, image mismatch and foreign article pages", () => {
    expect(() =>
      dailyGallery(html.replace("b_20964688.jpg", "b_99999999.jpg"), page),
    ).toThrow();
    expect(() =>
      dailyGallery(html.replace("f_20964688.jpg", "f_20964689.jpg"), page),
    ).toThrow();
    expect(() =>
      dailyGallery(
        html.replace(
          '<a href="?ph=3">',
          '<a href="/gossip/2026/10/25/0020999999.shtml?ph=3">',
        ),
        page,
      ),
    ).toThrow();
  });
  it("does not collect recommendations outside the photo roster", () => {
    expect(
      dailyGallery(
        html +
          '<aside><a href="?ph=6"><img src="https://example.com/ad.jpg"></a></aside>',
        page,
      )?.pages,
    ).toHaveLength(5);
  });
});
