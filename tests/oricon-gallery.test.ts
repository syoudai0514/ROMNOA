import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { oriconGallery } from "../server/oricon-gallery";
const html = readFileSync(
  new URL("./fixtures/oricon-gallery.html", import.meta.url),
  "utf8",
);
const feature = "https://www.oricon.co.jp/news/2460879/photo/2/?anc=112";
it("preserves the explicit photo roster and resolves the full current image despite tracking", () => {
  const g = oriconGallery(html, feature)!;
  expect(g.pages).toEqual([
    "https://www.oricon.co.jp/news/2460879/photo/1/",
    feature,
    "https://www.oricon.co.jp/news/2460879/photo/3/",
  ]);
  expect(g.picture.url).toContain("_p_o_85515691.jpg");
  expect(g.picture.alt).toContain("穂波あみ");
  expect(JSON.stringify(g)).not.toContain("recommend");
});
it("rejects a photo for a different article or a mismatched declared image", () => {
  expect(() =>
    oriconGallery(
      html.replaceAll(
        "/upimg/news/2461000/2460879/",
        "/upimg/news/2461000/999999/",
      ),
      feature,
    ),
  ).toThrow("gallery_structure_changed");
  expect(() =>
    oriconGallery(
      html.replace(
        'id="param-photo_id" name="param-photo_id" value="2"',
        'id="param-photo_id" name="param-photo_id" value="1"',
      ),
      feature,
    ),
  ).toThrow("gallery_structure_changed");
});

it("decodes publisher pages using their declared legacy character set", async () => {
  const { fetchPhotoHtml } = await import("../server/yahoo-photos");
  const load = async () =>
    new Response(new Uint8Array([0x93, 0xfa, 0x96, 0x7b]), {
      headers: { "content-type": "text/html; charset=Shift_JIS" },
    });
  expect(
    await fetchPhotoHtml(
      "https://publisher.example/photo/1",
      load as typeof fetch,
    ),
  ).toBe("日本");
});
