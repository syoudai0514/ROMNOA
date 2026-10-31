import { afterEach, describe, expect, it, vi } from "vitest";
import { handleReader } from "../server/reader";
import { handleSearch } from "../server/search";
import { handleSocial } from "../server/social";
import { handleYahooBody } from "../server/yahoo-body";
import { handleYahooPhotos } from "../server/yahoo-photos";
import { handleYahooPhotoImage } from "../server/yahoo-photo-image";
import { handleYahooSearch } from "../server/yahoo-search";
import { handleYahooTopics } from "../server/yahoo-topics";

const article = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const feature = "https://mdpr.jp/photo/detail/123456";
const xml = `<rss><channel><item><title>主要</title><comments>${article}/comments</comments></item></channel></rss>`;
const request = (path: string) => new Request(`https://app.example${path}`);
afterEach(() => vi.unstubAllEnvs());
describe("production API availability", () => {
  it("keeps reader, search, photo, social and topics routes available in production", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const fake = { get: async () => ({ sources: [{ status: "ok" }] }) };
    const responses = await Promise.all([
      handleReader(
        request(
          "/api/reader?article=" +
            encodeURIComponent("https://hamusoku.com/archives/11000000.html"),
        ),
        fake as never,
      ),
      handleSearch(request("/api/search?q=x&scope=body"), fake as never),
      handleSocial(
        request(
          "/api/social?url=" +
            encodeURIComponent("https://x.com/user/status/1234567890"),
        ),
        fake as never,
      ),
      handleYahooBody(
        request("/api/yahoo-body?article=" + encodeURIComponent(article)),
        async () => ({ article, pages: [], richPages: [], complete: true }),
      ),
      handleYahooPhotos(
        request("/api/yahoo-photos?article=" + encodeURIComponent(article)),
        fake as never,
      ),
      handleYahooPhotoImage(
        request(
          "/api/yahoo-photo-image?article=" +
            encodeURIComponent(article) +
            "&feature=" +
            encodeURIComponent(feature) +
            "&page=" +
            encodeURIComponent(feature),
        ),
        {
          get: async () => ({ body: new Uint8Array([1]), type: "image/jpeg" }),
        } as never,
      ),
      handleYahooSearch(request("/api/yahoo-search?q=x"), fake as never),
      handleYahooTopics(
        request("/api/yahoo-topics"),
        async () => new Response(xml),
      ),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
  });
});
