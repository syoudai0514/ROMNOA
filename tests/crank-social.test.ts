import { describe, expect, it } from "vitest";
import { crankSocial } from "../server/crank-social";
import { resolvePhotoPage, YahooPhotoService, MemoryPhotoCache } from "../server/yahoo-photos";
const article = "https://news.yahoo.co.jp/articles/3328dac1c997f4d9eba093e73eab4d265c96cdfc";
const feature = "https://www.crank-in.net/sns/news/192506/1";
const post = "https://x.com/sayaka_okada219/status/2108704392061067649";
const wrong = "https://x.com/unrelated/status/2108704392061067650";
const source = `<title>記事のSNS</title><main class="main-body"><article><h1 class="headline">記事</h1><div class="center-img-box"><strong>投稿</strong><blockquote class="twitter-tweet"><p>おはようございます</p><a href="${post}?ref_src=twsrc%5Etfw">投稿を見る</a></blockquote><div class="recommend"><blockquote class="twitter-tweet"><a href="${wrong}">別の投稿</a></blockquote><img src="https://example.com/ad.jpg"></div></div></article></main><aside><img src="https://www.crank-in.net/img/db/unrelated_300.jpg"></aside>`;
const metadata = `<script>window.__PRELOADED_STATE__=${JSON.stringify({ articleDetail: { contentId: "3328dac1c997f4d9eba093e73eab4d265c96cdfc", newsLink: article, richBody: [{ tagName: "a", attributes: { href: feature }, children: [{ type: "text", value: "【写真】記事の投稿" }] }] } })}</script>`;
describe("Crank-in social links", () => {
  it("selects the embedded post instead of unrelated recommendations or images", async () => {
    expect(crankSocial(source, feature)).toMatchObject({ kind: "social", posts: [{ provider: "X", url: post }] });
    const result = await resolvePhotoPage(source, feature);
    expect(result.strategy).toBe("crank-social");
    expect(result.data.kind).toBe("social");
    expect(JSON.stringify(result)).not.toContain("unrelated");
  });
  it("returns a social-only resource for an article-verified feature and rejects unrelated pages", async () => {
    const service = new YahooPhotoService(new MemoryPhotoCache(), async (url) => url === article ? metadata : source);
    const response = await service.get(article, feature);
    expect(response).toMatchObject({ kind: "social", articleId: article, featureUrl: feature, pageUrl: feature, posts: [{ provider: "X", url: post }] });
    expect("picture" in response).toBe(false);
    await expect(service.get(article, feature, `${feature}/other`)).rejects.toThrow();
    await expect(service.imageSource(article, feature, feature, false)).rejects.toThrow();
  });
  it("does not turn an invalid embedded post into a recommendation", () => {
    expect(() => crankSocial(source.replace(`${post}?ref_src=twsrc%5Etfw`, "https://evil.example/status/123"), feature)).toThrow("social_post_unavailable");
    expect(crankSocial(source, "https://other.example/sns/news/192506/1")).toBeNull();
  });
});
