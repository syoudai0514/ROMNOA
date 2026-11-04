import { describe, it, expect, vi } from "vitest";
import {
  fetchPhotoImage,
  PhotoImageService,
  handleYahooPhotoImage,
  OriginalUnavailable,
} from "../server/yahoo-photo-image";
import { originalPhotoCandidate } from "../src/lib/yahoo-photos-model";
import { PhotoAccessError } from "../server/yahoo-photos";
const family = "20260902dog00m200045000a",
  article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const page = `https://gravure.mantan-web.jp/article/${family}/photopage/001.html`;
const url = `https://storage.mantan-web.jp/w=1106,f=webp:auto/images/2026/09/02/${family}/001.jpg`;
const source = { url, referer: page };
const params = () =>
  new URLSearchParams({ article, feature: page, page, size: "full" });
const request = () =>
  new Request(`https://app/api/yahoo-photo-image?${params()}`);
describe("closed same-origin photo delivery", () => {
  it("fetches only the declared image with its real document context and blocks unbound targets", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/webp" },
        }),
    );
    const image = await fetchPhotoImage(source, fetcher);
    expect(image.type).toBe("image/webp");
    expect([...image.body]).toEqual([1, 2, 3]);
    expect(fetcher.mock.calls[0]).toMatchObject([
      url,
      {
        redirect: "error",
        headers: {
          Referer: page,
          "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
        },
      },
    ]);
    for (const bad of [
      { url: "http://127.0.0.1/", referer: page },
      { url, referer: "https://localhost/" },
      { url: url.replace(family, "20260903dog00m200046000a"), referer: page },
    ])
      await expect(fetchPhotoImage(bad, fetcher)).rejects.toThrow(
        "image_not_allowed",
      );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects HTML/SVG/redirects and oversized bodies instead of returning them as app content", async () => {
    for (const type of ["text/html", "image/svg+xml"])
      await expect(
        fetchPhotoImage(
          source,
          async () =>
            new Response("<script>bad</script>", {
              headers: { "content-type": type },
            }),
        ),
      ).rejects.toThrow("image_unavailable");
    await expect(
      fetchPhotoImage(
        source,
        async () =>
          new Response("redirect", {
            status: 302,
            headers: { location: "http://127.0.0.1" },
          }),
      ),
    ).rejects.toThrow();
    await expect(
      fetchPhotoImage(
        source,
        async () =>
          new Response("x", {
            headers: {
              "content-type": "image/png",
              "content-length": "2000001",
            },
          }),
      ),
    ).rejects.toThrow("image_too_large");
    await expect(
      fetchPhotoImage(
        source,
        async () =>
          new Response("x".repeat(2_000_001), {
            headers: { "content-type": "image/png" },
          }),
      ),
    ).rejects.toThrow("image_too_large");
  });
  it("shares bounded image loads but rechecks article/feature authorization even for cached images", async () => {
    let authorized = true;
    const resolve = {
      imageSource: vi.fn(async () => {
        if (!authorized) throw new PhotoAccessError("not_linked");
        return source;
      }),
    };
    const load = vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]),
      type: "image/png",
    }));
    const service = new PhotoImageService(resolve, load);
    await Promise.all([
      service.get(article, page, page, false),
      service.get(article, page, page, false),
    ]);
    await service.get(article, page, page, false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(resolve.imageSource).toHaveBeenCalledTimes(3);
    authorized = false;
    await expect(service.get(article, page, page, false)).rejects.toThrow(
      "not_linked",
    );
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("validates all parameters and Preview before loading; serves private raster bytes with nosniff and same-origin policy", async () => {
    const resolve = { imageSource: vi.fn(async () => source) },
      load = vi.fn(async () => ({
        body: new Uint8Array([1, 2, 3]),
        type: "image/png",
      }));
    const service = new PhotoImageService(resolve, load);
    for (const query of [
      "url=http://127.0.0.1",
      `${params()}&url=https://evil`,
      `${params()}&page=x`,
      new URLSearchParams({
        article,
        feature: page,
        page,
        size: "huge",
      }).toString(),
    ])
      expect(
        (
          await handleYahooPhotoImage(
            new Request(`https://app/api/yahoo-photo-image?${query}`),
            service,
            true,
          )
        ).status,
      ).toBe(400);
    expect(
      (await handleYahooPhotoImage(request(), service, false)).status,
    ).toBe(403);
    expect(
      (
        await handleYahooPhotoImage(
          new Request(request(), { method: "POST" }),
          service,
          true,
        )
      ).status,
    ).toBe(405);
    expect(resolve.imageSource).not.toHaveBeenCalled();
    const result = await handleYahooPhotoImage(request(), service, true);
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("image/png");
    expect(result.headers.get("Cache-Control")).toContain("private");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
    const forbidden = new PhotoImageService(
      {
        imageSource: async () => {
          throw new PhotoAccessError("bad");
        },
      },
      load,
    );
    expect(
      (await handleYahooPhotoImage(request(), forbidden, true)).status,
    ).toBe(403);
    const down = new PhotoImageService(resolve, async () => {
      throw Error("down");
    });
    expect((await handleYahooPhotoImage(request(), down, true)).status).toBe(
      502,
    );
  });
});

describe("background confirmation of WordPress originals", () => {
  const wp = "https://www.dailyshincho.com/wp-content/uploads/2026/10/1516437_2-345x230.jpg";
  const shincho = "https://www.dailyshincho.jp/article/2026/10301100/?photo=2";
  const png = (w: number, h: number) => {
    const b = new Uint8Array(32);
    b.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return { body: b, type: "image/png" };
  };
  const service = (original: () => Promise<{ body: Uint8Array; type: string }>) => {
    const loadOriginal = vi.fn(original);
    return {
      loadOriginal,
      engine: new PhotoImageService(
        { imageSource: vi.fn(async () => ({ url: wp, referer: shincho })) },
        vi.fn(async () => png(345, 230)),
        Date.now,
        loadOriginal,
      ),
    };
  };
  it("names only the WordPress original of a sized rendition", () => {
    expect(originalPhotoCandidate(wp)).toEqual({
      url: "https://www.dailyshincho.com/wp-content/uploads/2026/10/1516437_2.jpg",
      width: 345,
      height: 230,
    });
    for (const other of [
      "https://www.dailyshincho.com/wp-content/uploads/2026/10/1516437_2.jpg",
      "https://cdn.example.jp/photos/a-345x230.jpg",
      `${wp}?v=2`,
    ])
      expect(originalPhotoCandidate(other)).toBeNull();
  });
  it("serves an original that is a larger image of the same shape", async () => {
    const { engine, loadOriginal } = service(async () => png(1200, 799));
    const image = await engine.original(article, shincho, shincho);
    expect(image.body.byteLength).toBe(32);
    expect(loadOriginal).toHaveBeenCalledWith({
      url: "https://www.dailyshincho.com/wp-content/uploads/2026/10/1516437_2.jpg",
      referer: shincho,
    });
    await engine.original(article, shincho, shincho);
    expect(loadOriginal).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["a crop or a different picture", async () => png(1200, 1200)],
    ["no larger than the rendition", async () => png(360, 240)],
    ["not an image", async () => ({ body: new Uint8Array([1, 2, 3]), type: "image/jpeg" })],
    ["a failed request", async () => { throw Error("image_unavailable"); }],
  ])("keeps the rendition when the original is %s, and does not ask again", async (_, original) => {
    const { engine, loadOriginal } = service(original);
    await expect(engine.original(article, shincho, shincho)).rejects.toBeInstanceOf(OriginalUnavailable);
    await expect(engine.original(article, shincho, shincho)).rejects.toBeInstanceOf(OriginalUnavailable);
    expect(loadOriginal).toHaveBeenCalledTimes(1);
  });
  it("answers 404 so the client keeps the shown photo", async () => {
    const { engine } = service(async () => png(1200, 1200));
    const res = await handleYahooPhotoImage(
      new Request(`https://app/api/yahoo-photo-image?${new URLSearchParams({ article, feature: shincho, page: shincho, size: "original" })}`),
      engine,
      true,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

