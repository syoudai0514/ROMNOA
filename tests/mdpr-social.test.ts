import { describe, expect, it } from "vitest";
import { mdprSocial } from "../server/mdpr-social";
import { resolvePhotoPage, YahooPhotoService, MemoryPhotoCache } from "../server/yahoo-photos";
const article = "https://news.yahoo.co.jp/articles/eda34b5f450869510cb1a7d96f75ca6117813a39";
const feature = "https://mdpr.jp/photo/embed/4868239";
const post = "https://www.instagram.com/p/DfE9frOE_Xq/";
const source = `<title>関連投稿</title><div class="pg-photo__body"><div class="pg-embed__embed"><div class="moki-instagram-video"><blockquote class="instagram-media" data-instgrm-permalink="${post}?utm_source=ig_embed&amp;utm_campaign=loading"><a href="${post}">投稿を見る</a></blockquote></div><div class="recommend"><blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/other12345/"></blockquote></div></div></div><aside><img src="https://example.com/unrelated.jpg"></aside>`;
const metadata = `<script>window.__PRELOADED_STATE__=${JSON.stringify({ articleDetail: { contentId: "eda34b5f450869510cb1a7d96f75ca6117813a39", newsLink: article, richBody: [{ tagName: "a", attributes: { href: feature }, children: [{ type: "text", value: "【写真】投稿" }] }] } })}</script>`;
describe("Modelpress embedded social posts", () => {
  it("extracts the article's Instagram post without treating recommendations as photos", async () => {
    const result = await resolvePhotoPage(source, feature);
    expect(result.strategy).toBe("mdpr-social");
    expect(result.data).toMatchObject({ kind: "social", posts: [{ provider: "Instagram", url: post }] });
    expect(JSON.stringify(result)).not.toContain("other12345");
    expect(JSON.stringify(result)).not.toContain("unrelated");
  });
  it("returns the verified social link for the linked article, and rejects unauthorized pages", async () => {
    const service = new YahooPhotoService(new MemoryPhotoCache(), async (url) => url === article ? metadata : source);
    const response = await service.get(article, feature);
    expect(response).toMatchObject({ kind: "social", featureUrl: feature, posts: [{ provider: "Instagram", url: post }] });
    expect("picture" in response).toBe(false);
    await expect(service.get(article, feature, "https://mdpr.jp/photo/embed/9999999")).rejects.toThrow("page_not_linked");
    await expect(service.imageSource(article, feature, feature, false)).rejects.toThrow();
  });
  it("rejects missing or unverified embedded posts instead of displaying unrelated images", () => {
    expect(() => mdprSocial(source.replaceAll(post, "https://evil.example/post"), feature)).toThrow("social_post_unavailable");
    expect(() => mdprSocial('<div class="related">おすすめ</div>', feature)).toThrow("social_post_unavailable");
    expect(mdprSocial(source, "https://other.example/photo/embed/4868239")).toBeNull();
  });
});
