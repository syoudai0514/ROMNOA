import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bunshunGallery } from "../server/bunshun-gallery";
const url = "https://bunshun.jp/articles/photo/93238?pn=1";
const html = readFileSync(
  new URL("./fixtures/bunshun-gallery.html", import.meta.url),
  "utf8",
);
const names = [
  "cee4b726694f36be6c773ebc0f003c1e278925",
  "d5b9518800fed4675c6f1f8c8cbec327175046",
  "de93cd88bf3e0d4a3ad70e34939be23978878",
  "728839a10564e4ebe8aa861046f012bd162254",
];
const fetcher: typeof fetch = async (input) => {
  const n = Number(new URL(String(input)).searchParams.get("pn"));
  const id = names[n - 1];
  return Response.json({
    src: `https://bunshun.ismcdn.jp/mwimgs/c/e/1500wm/img_${id}.jpg`,
    caption: "写真の説明",
  });
};
describe("publisher full-resolution photo data", () => {
  it("loads all declared photos in order without using the small thumbnails as full images", async () => {
    const g = await bunshunGallery(html, url, fetcher);
    expect(g?.pictures).toHaveLength(4);
    expect(g?.pictures[0].url).toContain("1500wm");
    expect(g?.thumbnails[0].url).toContain("64h");
    expect(g?.pages[1]).toContain("#romnoa-photo-2");
  });
  it("rejects images not matching the gallery and out-of-range photo requests", async () => {
    await expect(
      bunshunGallery(html, url, async () =>
        Response.json({ src: "https://bunshun.ismcdn.jp/other.jpg" }),
      ),
    ).rejects.toThrow("photo_mismatch");
    await expect(
      bunshunGallery(html, url.replace("pn=1", "pn=9"), fetcher),
    ).rejects.toThrow();
  });
  it("recognises other publishers on the same gallery CMS by markup, not hostname", async () => {
    const other = url.replace("bunshun.jp", "toyokeizai.net");
    const seen: string[] = [];
    const g = await bunshunGallery(html, other, async (input) => {
      seen.push(new URL(String(input)).origin);
      return fetcher(input);
    });
    expect(g?.pictures).toHaveLength(4);
    expect(new Set(seen)).toEqual(new Set(["https://toyokeizai.net"]));
    expect(await bunshunGallery("<main></main>", other, fetcher)).toBeNull();
    await expect(
      bunshunGallery("<main></main>", url, fetcher),
    ).rejects.toThrow();
  });
});

describe("when the publisher photo API refuses requests", () => {
  const refused: typeof fetch = async () =>
    new Response('{"status":"406"}', { status: 406, headers: { "content-type": "application/json" } });
  const withOg = (id: string, host = "https://bunshun.jp") =>
    `<meta property="og:image" content="${host}/mwimgs/c/e/1200wm/img_${id}.jpg">${html}`;
  it("uses the large rendition the page declares for the shown photo", async () => {
    const g = await bunshunGallery(withOg(names[0]), url, refused);
    expect(g?.pictures).toHaveLength(4);
    expect(g?.pictures.every((p) => p.url.includes("/1200wm/"))).toBe(true);
    expect(g?.pictures[2].url).toContain(names[2]);
    expect(g?.thumbnails[0].url).toContain("64h");
  });
  it("keeps failing when og:image is a different photograph", async () => {
    await expect(bunshunGallery(withOg(names[1]), url, refused)).rejects.toThrow("photo_source_unavailable");
    await expect(bunshunGallery(html, url, refused)).rejects.toThrow("photo_source_unavailable");
  });
  it("reports a mismatching photo even when another request was refused first", async () => {
    const mixed: typeof fetch = async (input) => {
      const n = Number(new URL(String(input)).searchParams.get("pn"));
      if (n === 1) return refused(input);
      await new Promise((r) => setTimeout(r, 5));
      return Response.json({ src: "https://bunshun.ismcdn.jp/mwimgs/c/e/1500wm/img_other.jpg" });
    };
    await expect(bunshunGallery(withOg(names[0]), url, mixed)).rejects.toThrow("photo_mismatch");
  });
  it("does not trust og:image from an unrelated host", async () => {
    await expect(
      bunshunGallery(withOg(names[0], "https://cdn.unrelated.example"), url, refused),
    ).rejects.toThrow("photo_source_unavailable");
  });
});
