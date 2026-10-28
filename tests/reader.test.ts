import { describe, it, expect, vi } from "vitest";
import {
  articleTarget,
  linkedArticle,
  extractArticle,
  fetchArticle,
  ReaderService,
  MemoryReaderCache,
  handleReader,
} from "../server/reader";
import {
  readerDocumentSchema,
  readerImageUrl,
  readerLinkUrl,
} from "../src/lib/reader-model";
import { article, feed } from "./fixtures";

const a = article();
const picture = "https://livedoor.blogimg.jp/hamusoku/imgs/1/2/example.jpg";
const html = `<html><body><nav>サイトナビ</nav><div class="article-body-inner"><p>本文の最初。&amp; 読めます。</p><script>evil()</script><iframe src="https://ads.test/a"></iframe><div class="adsbygoogle">広告本文</div><div id="div-gpt-ad-1">別の広告</div><a href="javascript:alert(1)">リンクの文章</a><img src="${picture}" width="600" onerror="evil()"><img src="https://track.test/pixel.png"><img src="${picture.replace("example", "pixel")}" width="1" height="1"></div><div class="article-body-more"><p>続きの本文です。</p><aside class="related">関連記事本文</aside><video autoplay src="https://ads.test/movie"></video></div><footer>サイトフッター</footer></body></html>`;
const document = () => extractArticle(html, a);

describe("Personal article reader", () => {
  it("recognizes Pickup pages and keeps their actual story links instead of presenting cover images as the body", () => {
    const url = "https://alfalfalfa.com/articles/11110000.html";
    const story = "https://alfalfalfa.com/articles/11089177.html";
    const d = extractArticle(
      `<div class="article_body">
      <div class="daily_popular_title"><a href="https://antenna.example/pick?item=1">[テスト用] 本編のタイトル</a></div>
      <div class="eye-catch"><img src="https://livedoor.blogimg.jp/amosaic/imgs/1/2/cover-s.jpg"></div>
      <div class="daily_popular_title"><a href="${story}">[テスト用] 本編のタイトル</a></div>
      <a href="${story}">続きを読む</a>
      <a href="https://alfalfalfa.com/articles/11007783.html?from=random_text_link&area=history&type=ranran5&pos=1">[テスト用] もう一つの記事</a>
      </div>`,
      {
        ...a,
        id: url,
        url,
        sourceId: "alfalfa",
        title: "[テスト用] 本編のタイトル【Pickup27072830】",
      },
    );
    expect(d.pageKind).toBe("roundup");
    expect(d.blocks.some((b) => b.type === "image")).toBe(false);
    expect(d.related[0].article).toMatchObject({
      id: story,
      title: "[テスト用] 本編のタイトル",
    });
    expect(d.related[1].article.url).toBe(
      "https://alfalfalfa.com/articles/11007783.html",
    );
    expect(d.links.map((link) => link.url)).not.toContain(
      "https://antenna.example/pick?item=1",
    );
  });
  it("retains linked X body photos and the original external links, but never scripts or advertisements", () => {
    const photo = "https://pbs.twimg.com/media/Example_123.jpg";
    const d = extractArticle(
      `<div class="article-body-inner"><p><a href="https://x.com/example">画像の投稿元</a></p>
      <a href="${photo}"><img src="${photo}"></a><a href="javascript:alert(1)">危険なリンク</a>
      <a rel="sponsored" href="https://ads.example/">広告リンク</a></div>`,
      a,
    );
    expect(d.blocks.filter((b) => b.type === "image")).toEqual([
      { type: "image", url: photo, alt: "記事内の画像" },
    ]);
    expect(d.links).toContainEqual({
      url: "https://x.com/example",
      title: "画像の投稿元",
    });
    expect(
      d.links.some((link) => /javascript|ads\.example/.test(link.url)),
    ).toBe(false);
  });
  it("bounds X image URLs to media files and supported parameters", () => {
    expect(
      readerImageUrl(
        "https://pbs.twimg.com/media/Example?format=jpg&name=large",
        "alfalfa",
      ),
    ).toBe("https://pbs.twimg.com/media/Example?format=jpg&name=large");
    for (const url of [
      "https://pbs.twimg.com.evil.test/media/Example.jpg",
      "https://pbs.twimg.com/profile_images/Example.jpg",
      "http://pbs.twimg.com/media/Example.jpg",
      "https://pbs.twimg.com/media/Example.svg",
      "https://pbs.twimg.com/media/Example.jpg?url=evil",
      "https://pbs.twimg.com/media/Example?format=svg",
      "https://pbs.twimg.com/media/Example.jpg?name=large&name=orig",
    ])
      expect(readerImageUrl(url, "alfalfa")).toBeNull();
  });
  it("allows browser navigation only to web URLs without credentials or private-network addresses", () => {
    expect(readerLinkUrl("/source", "https://example.com/post")).toBe(
      "https://example.com/source",
    );
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,evil",
      "https://user:pass@example.com/",
      "http://127.0.0.1/",
      "https://server.local/",
      "https://localhost/",
      "https://[::1]/",
    ])
      expect(readerLinkUrl(url)).toBeNull();
  });
  it("labels publisher eye-catch images separately from photographs in the body", () => {
    const d = extractArticle(
      `<div class="article-body-inner"><div class="eye-catch"><img src="${picture}"></div><p>写真の本文</p></div>`,
      a,
    );
    expect(d.blocks[0]).toMatchObject({ type: "image", role: "cover" });
  });
  it("separates article photographs, affiliate banners, uncertain links and other-article images", () => {
    const full = picture.replace("example", "original");
    const other = article(55);
    const d = extractArticle(
      `<meta property="og:image" content="${picture.replace("example", "outside")}">
      <div class="article-body-inner">
      <a href="${full}"><img data-original="${picture}" src="https://tracker.invalid/placeholder" width="500px"></a>
      <a href="https://amzn.to/product"><img src="${picture.replace("example", "affiliate")}"></a>
      <a href="https://unknown.invalid/redirect"><img src="${picture.replace("example", "uncertain")}"></a>
      <img src="https://tracker.invalid/pixel.png" width="1px" height="1px">
      <img src="https://other-images.invalid/unverified.jpg">
      <div class="manual-related"><a href="${other.url}?utm_source=test"><img src="${picture.replace("example", "other")}">${other.title}</a></div>
      <div class="advertisement"><a href="${article(56).url}">広告からの誘導<img src="${picture}"></a></div>
      <p>記事の本文。</p></div>`,
      a,
    );
    expect(d.blocks.filter((b) => b.type === "image")).toEqual([
      { type: "image", url: full, alt: "記事内の画像" },
    ]);
    expect(d.imageAudit).toEqual({ excluded: 3, uncertain: 2, related: 1 });
    expect(d.related).toHaveLength(1);
    expect(d.related[0].article.id).toBe(other.id);
    expect(d.related[0].thumbnail).toBe(picture.replace("example", "other"));
  });
  it("collects editorial titles and thumbnails separately without executing recommendation scripts", () => {
    const other = article(65, { title: "[テスト用] 休日の料理と写真まとめ" });
    const thumb = picture.replace("example", "thumbnail");
    const d = extractArticle(
      `<div class="article-body-inner">本文</div>
      <ul class="recent-article-image"><li><a href="${other.url}"><img src="https://resize.blogsys.jp/hash/crop1/100x100/${thumb}"></a>
      <a href="${other.url}?utm_medium=related">${other.title}</a></li></ul>
      <aside class="ads"><div class="related"><a href="${article(66).url}">広告内の別記事リンク</a></div></aside>
      <div hidden><ul class="related"><a href="${article(67).url}">隠された別記事リンク</a></ul></div>
      <script>document.write('unsafe recommendations')</script>`,
      a,
    );
    expect(d.related).toEqual([
      { article: { ...other, publishedAt: null }, thumbnail: thumb },
    ]);
    expect(d.blocks).toEqual([{ type: "text", text: "本文" }]);
  });
  it("normalizes only direct editorial links and rejects redirect parameters and foreign hosts", () => {
    expect(
      linkedArticle("/archives/11000055.html?utm_source=x#comments", a.url)
        ?.url,
    ).toBe(article(55).url);
    expect(
      linkedArticle("http://hamusoku.com/archives/11000055.html", a.url)?.url,
    ).toBe(article(55).url);
    for (const link of [
      "javascript:alert(1)",
      "https://hamusoku.com/archives/11000055.html?url=https://evil.test",
      "https://evil.test/archives/11000055.html",
      "https://user@hamusoku.com/archives/11000055.html",
    ])
      expect(linkedArticle(link, a.url)).toBeNull();
  });
  it("follows a verified related chain outside RSS but refuses invented or expired parent links", async () => {
    const second = article(70),
      third = article(71),
      invented = article(72);
    let now = Date.now();
    const cache = new MemoryReaderCache();
    const load = vi.fn(async (target) =>
      extractArticle(
        `<div class="article-body-inner"><p>本文の画像まとめ</p>
      <a href="${target.id === a.id ? second.url : third.url}">次に気になる画像まとめ</a></div>`,
        target,
        now,
      ),
    );
    const service = new ReaderService(
      cache,
      { get: async () => feed },
      load,
      () => now,
    );
    await service.get(a.id);
    await expect(service.get(second.id, invented.id)).rejects.toThrow(
      "確認済み",
    );
    await expect(service.get(invented.id, a.id)).rejects.toThrow("確認済み");
    await service.get(second.id, a.id);
    await service.get(third.id, second.id);
    expect(load).toHaveBeenCalledTimes(3);
    now += 86_400_001;
    await expect(service.get(second.id, a.id)).rejects.toThrow("確認済み");
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("rejects forged related image provenance and obsolete cached image classification", () => {
    const d = document();
    expect(
      readerDocumentSchema.safeParse({ ...d, schemaVersion: 2 }).success,
    ).toBe(false);
    expect(
      readerDocumentSchema.safeParse({
        ...d,
        related: [
          { article: article(55), thumbnail: "https://ads.invalid/banner.jpg" },
        ],
      }).success,
    ).toBe(false);
  });
  it("extracts both body parts and excludes ads, page furniture, scripts, iframes, videos and tracking images", () => {
    const d = document();
    const text = d.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    expect(text).toContain("本文の最初。& 読めます。");
    expect(text).toContain("続きの本文です。");
    expect(text).toContain("リンクの文章");
    expect(text).not.toMatch(/広告|ナビ|フッター|関連記事|evil/);
    expect(d.blocks.filter((b) => b.type === "image")).toEqual([
      { type: "image", url: picture, alt: "記事内の画像" },
    ]);
    expect(JSON.stringify(d)).not.toMatch(
      /javascript:|onerror|<script|iframe|ads\.test|track\.test/,
    );
  });
  it("supports alfalfa body classes and does not duplicate nested roots", () => {
    const url = "https://alfalfalfa.com/articles/11110000.html";
    const d = extractArticle(
      '<div class="article_body"><div class="article_bodymore"><p>アルファ本文</p></div></div>',
      { ...a, sourceId: "alfalfa", id: url, url },
    );
    expect(d.blocks).toEqual([{ type: "text", text: "アルファ本文" }]);
  });
  it("never uses the whole page when the source body structure is missing", () => {
    expect(() =>
      extractArticle(
        "<html><body><p>広告だらけの全ページ</p></body></html>",
        a,
      ),
    ).toThrow("本文を読み取れません");
  });
  it.each([
    "http://hamusoku.com/archives/11000000.html",
    "https://hamusoku.com/admin",
    "https://127.0.0.1/archives/11000000.html",
    "https://hamusoku.com.evil.test/archives/11000000.html",
    "https://hamusoku.com:8080/archives/11000000.html",
    "https://hamusoku.com/archives/11000000.html?url=evil",
    "https://hamusoku.com/archives/11000000.html#part",
  ])("rejects unsupported article target: %s", (url) =>
    expect(articleTarget(url)).toBeNull(),
  );
  it("does not fetch off-source targets and blocks redirects with a bounded request", async () => {
    const fetcher = vi.fn(async (_url, options) => {
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeDefined();
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    });
    expect(
      (await fetchArticle(a, fetcher as typeof fetch)).blocks.length,
    ).toBeGreaterThan(0);
    await expect(
      fetchArticle({ ...a, url: "http://127.0.0.1/" }, fetcher as typeof fetch),
    ).rejects.toThrow("対応していない");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized, failed and non-HTML responses", async () => {
    for (const response of [
      new Response("denied", { status: 403 }),
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
      new Response(new Uint8Array(2_000_001), {
        headers: { "Content-Type": "text/html" },
      }),
    ])
      await expect(
        fetchArticle(
          a,
          vi.fn(async () => response),
        ),
      ).rejects.toThrow();
  });
  it("validates image provenance in cached documents", () => {
    const d = document();
    expect(readerDocumentSchema.safeParse(d).success).toBe(true);
    expect(
      readerDocumentSchema.safeParse({
        ...d,
        blocks: [{ type: "image", url: "https://tracker.test/a.jpg", alt: "" }],
      }).success,
    ).toBe(false);
    expect(
      readerDocumentSchema.safeParse({
        ...d,
        blocks: [{ type: "image", url: picture + "?tracking=1", alt: "" }],
      }).success,
    ).toBe(false);
  });
  it("only fetches articles in the known feed and coalesces/cache-serves repeat reads", async () => {
    const load = vi.fn(async () => document());
    const service = new ReaderService(
      new MemoryReaderCache(),
      { get: async () => feed },
      load,
    );
    await Promise.all([service.get(a.id), service.get(a.id)]);
    await service.get(a.id);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(
      service.get("https://hamusoku.com/archives/11999999.html"),
    ).rejects.toThrow("確認済みの関連記事にもない");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("cools down upstream failures and does not repeatedly hit a broken source", async () => {
    const load = vi.fn(async () => {
      throw new Error("offline");
    });
    const service = new ReaderService(
      new MemoryReaderCache(),
      { get: async () => feed },
      load,
    );
    await expect(service.get(a.id)).rejects.toThrow();
    await expect(service.get(a.id)).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("fails closed for production/public use and accepts only the single known article parameter", async () => {
    const service = { get: vi.fn(async () => document()) };
    expect(
      (
        await handleReader(
          new Request(
            "https://app.test/api/reader?article=" + encodeURIComponent(a.id),
          ),
          service,
          false,
        )
      ).status,
    ).toBe(403);
    for (const query of [
      "?article=http://127.0.0.1/",
      "?article=" + encodeURIComponent(a.id) + "&other=1",
      "?article=" +
        encodeURIComponent(a.id) +
        "&article=" +
        encodeURIComponent(a.id),
      "?article=" + encodeURIComponent(a.id) + "&from=http://127.0.0.1/",
      "?article=" + encodeURIComponent(a.id) + "&from=",
      "?article=" +
        encodeURIComponent(a.id) +
        "&from=" +
        encodeURIComponent(article(55).id) +
        "&from=" +
        encodeURIComponent(article(55).id),
    ])
      expect(
        (
          await handleReader(
            new Request("https://app.test/api/reader" + query),
            service,
            true,
          )
        ).status,
      ).toBe(400);
    expect(service.get).not.toHaveBeenCalled();
    const result = await handleReader(
      new Request(
        "https://app.test/api/reader?article=" + encodeURIComponent(a.id),
      ),
      service,
      true,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    const from = article(55).id;
    expect(
      (
        await handleReader(
          new Request(
            "https://app.test/api/reader?article=" +
              encodeURIComponent(a.id) +
              "&from=" +
              encodeURIComponent(from),
          ),
          service,
          true,
        )
      ).status,
    ).toBe(200);
    expect(service.get).toHaveBeenLastCalledWith(a.id, from);
  });
});
