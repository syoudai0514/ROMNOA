import { describe, it, expect, vi } from "vitest";
import {
  articleTarget,
  extractArticle,
  fetchArticle,
  ReaderService,
  MemoryReaderCache,
  handleReader,
} from "../server/reader";
import { readerDocumentSchema } from "../src/lib/reader-model";
import { article, feed } from "./fixtures";

const a = article();
const picture = "https://livedoor.blogimg.jp/hamusoku/imgs/1/2/example.jpg";
const html = `<html><body><nav>サイトナビ</nav><div class="article-body-inner"><p>本文の最初。&amp; 読めます。</p><script>evil()</script><iframe src="https://ads.test/a"></iframe><div class="adsbygoogle">広告本文</div><div id="div-gpt-ad-1">別の広告</div><a href="javascript:alert(1)">リンクの文章</a><img src="${picture}" width="600" onerror="evil()"><img src="https://track.test/pixel.png"><img src="${picture.replace("example", "pixel")}" width="1" height="1"></div><div class="article-body-more"><p>続きの本文です。</p><aside class="related">関連記事本文</aside><video autoplay src="https://ads.test/movie"></video></div><footer>サイトフッター</footer></body></html>`;
const document = () => extractArticle(html, a);

describe("Personal article reader", () => {
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
    ).rejects.toThrow("配信フィードにない");
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
  });
});
