import { describe, expect, it } from "vitest";
import { encountSocial } from "../server/encount-social";
import { resolvePhotoPage, YahooPhotoService, MemoryPhotoCache } from "../server/yahoo-photos";
const article = "https://news.yahoo.co.jp/articles/c254ee426d13ef6874096147ac3a2ec134df1ddc";
const feature = "https://encount.press/archives/637289/2/";
const post = "https://www.instagram.com/p/C8JoihYyzVU/";
const block = (url = post) => `<blockquote class="instagram-media" data-instgrm-permalink="${url}?utm_source=ig_embed&amp;utm_campaign=loading"></blockquote>`;
const source = `<title>投稿の写真</title><article id="single"><div class="single__content"><div class="paragraph"><h2>【写真】実際の投稿</h2><div class="single__content__txt"><div class="photo-wrap">${block()}${block()}<div class="related">${block("https://www.instagram.com/p/other12345/")}</div></div></div></div></div><aside>${block("https://www.instagram.com/p/aside12345/")}</aside></article>`;
const metadata = `<script>window.__PRELOADED_STATE__=${JSON.stringify({articleDetail:{contentId:article.split('/').pop(),newsLink:article,richBody:[{tagName:'a',attributes:{href:feature},children:[{type:'text',value:'【写真】実際の投稿'}]}]}})}</script>`;
describe("ENCOUNT photo pages containing social embeds", () => {
  it("resolves the real Instagram post, deduplicates it and excludes related posts", async () => {
    const result = await resolvePhotoPage(source, feature);
    expect(result.strategy).toBe("encount-social");
    expect(result.data).toMatchObject({kind:"social",posts:[{provider:"Instagram",url:post}]});
    expect(result.data.posts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('other12345');
    expect(JSON.stringify(result)).not.toContain('aside12345');
  });
  it("retains article authorization and does not turn posts into image URLs", async () => {
    const service=new YahooPhotoService(new MemoryPhotoCache(),async url=>url===article?metadata:source);
    expect(await service.get(article,feature)).toMatchObject({kind:"social",featureUrl:feature,posts:[{url:post}]});
    await expect(service.get(article,feature,'https://encount.press/archives/999999/2/')).rejects.toThrow('page_not_linked');
    await expect(service.imageSource(article,feature,feature,false)).rejects.toThrow();
  });
  it("requires a valid scoped embed and leaves ordinary gallery parsing available", () => {
    expect(encountSocial(source.replaceAll(post,'https://evil.example/post'),feature)).toBeNull();
    expect(encountSocial(source.replace('photo-wrap','unrelated-content'),feature)).toBeNull();
    expect(encountSocial(source.replace('single__content__txt','related'),feature)).toBeNull();
    expect(encountSocial(source.replace('photo-wrap','photo-wrap related'),feature)).toBeNull();
    expect(encountSocial(source.replace('photo-wrap','photo-wrap" hidden="'),feature)).toBeNull();
    expect(encountSocial(source,feature.replace('encount.press','other.example'))).toBeNull();
    expect(encountSocial(source,'https://encount.press/archives/637289/')).toBeNull();
    expect(encountSocial('<article id="single"><img src="https://example.com/photo.jpg"></article>',feature)).toBeNull();
  });
});
