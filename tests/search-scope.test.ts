import { describe, it, expect, vi } from "vitest";
import {
  extractSearchText,
  SearchTextService,
  MemorySearchTextCache,
} from "../server/search-content";
import {
  SearchService,
  MemorySearchCache,
  handleSearch,
} from "../server/search";
import { matchesSearch } from "../src/lib/search-model";
import type { Article } from "../src/lib/model";
import { article } from "./fixtures";

describe("search targets exclude editorial links", () => {
  it.each(["hamusoku", "alfalfa"] as const)(
    "extracts only %s story roots, including more, excluding all recommendation and anchor labels",
    (sourceId) => {
      const first =
        sourceId === "hamusoku" ? "article-body-inner" : "article_body";
      const more =
        sourceId === "hamusoku" ? "article-body-more" : "article_bodymore";
      const text = extractSearchText(
        `<aside>外側の検索語</aside><div class="${first}">
      <p>本物の話題は図書館です。<b>太字の本文</b></p>
      <blockquote><p>引用の本文も残す</p><a href="https://x.com/u/status/1">リンク内検索語</a></blockquote>
      <div class="manual-related">関連限定語<a href="/articles/11110000.html">別の記事</a></div>
      <div id="recommend-list">推奨限定語</div><div class="blogroll">アンテナ限定語</div>
      <div class="adsbygoogle">広告限定語</div><div hidden>非表示限定語</div>
      <script>スクリプト限定語</script><iframe>埋込限定語</iframe>
      <a href="https://example.org/story">クラスなしリンク限定語</a><img alt="alt限定語">
      <h3>おすすめ記事</h3><p>見出し以降の限定語</p>
      </div><div class="${more}"><p>続きを読む側の本文です</p></div><footer>フッター限定語</footer>`,
        sourceId,
      );
      for (const word of [
        "図書館",
        "太字の本文",
        "引用の本文",
        "続きを読む側の本文",
      ])
        expect(text).toContain(word);
      for (const word of [
        "外側の検索語",
        "リンク内検索語",
        "関連限定語",
        "推奨限定語",
        "アンテナ限定語",
        "広告限定語",
        "非表示限定語",
        "スクリプト限定語",
        "埋込限定語",
        "クラスなしリンク限定語",
        "alt限定語",
        "見出し以降の限定語",
        "フッター限定語",
      ])
        expect(text).not.toContain(word);
    },
  );
  it("deduplicates nested roots and fails closed on unknown, oversize or excessively complex layout", () => {
    expect(
      extractSearchText(
        '<div class="article_body"><div class="article_bodymore">本文</div></div>',
        "alfalfa",
      ),
    ).toBe("本文");
    expect(() =>
      extractSearchText("<main>サイト本文</main>", "alfalfa"),
    ).toThrow("missing");
    expect(() => extractSearchText("x".repeat(2000001), "alfalfa")).toThrow(
      "large",
    );
    expect(() =>
      extractSearchText(
        "<div>".repeat(122) + "本文" + "</div>".repeat(122),
        "alfalfa",
      ),
    ).toThrow("complex");
    expect(matchesSearch("ＡＢＣの図書館", "abc 図書館")).toBe(true);
    expect(matchesSearch("図書館の写真", "図書館 海辺")).toBe(false);
  });
  it("filters title mode without fetching bodies; body mode requires actual story words, not candidate snippets", async () => {
    const title = article(9001, { title: "図書館の話題" }),
      body = article(9002, { title: "静かな場所" }),
      related = article(9003, { title: "別の話題" }),
      failed = article(9004, { title: "取得できない話題" });
    const load = vi.fn(async () => ({
      articles: [title, body, related, failed],
      hasNext: true,
    }));
    const bodies = vi.fn(async (a: Article) =>
      a.id === body.id
        ? "本文の図書館で読書"
        : a.id === related.id
          ? "図書室について"
          : null,
    );
    const metrics = vi.fn(async () => ({}));
    const service = new SearchService(
      new MemorySearchCache(),
      load,
      Date.now,
      metrics,
      bodies,
    );
    const first = await service.get("図書館", 1, ["hamusoku"], "title");
    expect(first.articles.map((a) => a.id)).toEqual([title.id]);
    expect(first).toMatchObject({
      scope: "title",
      excludedCount: 3,
      unverifiedCount: 0,
      nextSources: ["hamusoku"],
    });
    expect(bodies).not.toHaveBeenCalled();
    const full = await service.get("図書館", 1, ["hamusoku"], "body");
    expect(full.articles.map((a) => a.id).sort()).toEqual(
      [title.id, body.id].sort(),
    );
    expect(full).toMatchObject({
      scope: "body",
      excludedCount: 1,
      unverifiedCount: 1,
    });
    expect(bodies).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenCalledTimes(1);
    expect(metrics).toHaveBeenLastCalledWith(full.articles);
    expect(full.collection).toBe(first.collection);
  });
  it("does AND matching across title and clean body and leaves empty filtered pages navigable", async () => {
    const a = article(9005, { title: "図書館の話" });
    const service = new SearchService(
      new MemorySearchCache(),
      async () => ({ articles: [a], hasNext: true }),
      Date.now,
      async () => null,
      async () => "海辺の風景",
    );
    expect(
      (await service.get("図書館 海辺", 1, ["hamusoku"], "body")).articles,
    ).toHaveLength(1);
    const empty = await service.get("図書館 海辺", 1, ["hamusoku"], "title");
    expect(empty.articles).toHaveLength(0);
    expect(empty.nextSources).toEqual(["hamusoku"]);
  });
  it("validates scope and keeps body inspection private before invoking service", async () => {
    const get = vi.fn();
    for (const suffix of ["&scope=wrong", "&scope=title&scope=body"])
      expect(
        (
          await handleSearch(
            new Request("https://app/api/search?q=test" + suffix),
            { get },
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await handleSearch(
          new Request("https://app/api/search?q=test&scope=body"),
          { get },
          false,
        )
      ).status,
    ).toBe(403);
    expect(get).not.toHaveBeenCalled();
  });
  it("coalesces and caches clean text independently, throttles failures, expires in 24h, refuses unsupported targets", async () => {
    let now = 100000;
    const load = vi.fn(
      async () =>
        '<div class="article-body-inner">実際の本文<a href="https://x.test">混入するリンク</a></div>',
    );
    const svc = new SearchTextService(
      new MemorySearchTextCache(),
      load,
      () => now,
    );
    const a = article(9006);
    const result = await Promise.all([svc.get(a), svc.get(a)]);
    expect(result).toEqual(["実際の本文", "実際の本文"]);
    expect(load).toHaveBeenCalledTimes(1);
    await svc.get(a);
    expect(load).toHaveBeenCalledTimes(1);
    now += 86400001;
    await svc.get(a);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await svc.get({ ...a, url: "https://evil.test/a" })).toBeNull();
    load.mockRejectedValue(new Error("down"));
    const b = article(9007);
    expect(await svc.get(b)).toBeNull();
    expect(await svc.get(b)).toBeNull();
    expect(load).toHaveBeenCalledTimes(3);
    now += 60001;
    expect(await svc.get(b)).toBeNull();
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("bounds concurrent upstream loads and skips aborted queued requests", async () => {
    let active = 0,
      max = 0;
    const releases: (() => void)[] = [];
    const load = vi.fn(async () => {
      max = Math.max(max, ++active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return '<div class="article-body-inner">本文</div>';
    });
    const svc = new SearchTextService(new MemorySearchTextCache(), load);
    const abort = new AbortController();
    const requests = Array.from({ length: 8 }, (_, i) =>
      svc.get(article(9020 + i), abort.signal),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(6));
    abort.abort();
    releases.forEach((release) => release());
    const results = await Promise.all(requests);
    expect(max).toBe(6);
    expect(load).toHaveBeenCalledTimes(6);
    expect(results.slice(6)).toEqual([null, null]);
  });
});
