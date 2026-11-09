import { describe, it, expect, vi } from "vitest";
import {
  RoundupIndex,
  archiveCursor,
  parseArchivePage,
  parseArchiveCursor,
  fetchArchivePage,
} from "../server/roundup-index";
import { article } from "./fixtures";
import type { ArchiveStore } from "../server/news-archive";
const now = () => Date.parse("2026-11-09T00:00:00Z");
const old = article(123, {
  title: "美脚の過去記事",
  publishedAt: "2010-01-10T00:00:00Z",
});
const store = () => {
  const files = new Map<string, string>();
  return {
    write: vi.fn(async (k: string, v: string) => {
      files.set(k, v);
    }),
    read: vi.fn(async (k: string) => files.get(k) || null),
    paths: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
  } satisfies ArchiveStore;
};
describe("independent historical archive index", () => {
  it("finds a story the keyword search never returned and preserves page 2 before going to the previous month", async () => {
    const load = vi.fn(async (source: any, month: string, page: number) => ({
      articles: source === "hamusoku" && page === 2 ? [old] : [],
      next: source === "hamusoku" && page === 1,
    }));
    const index = new RoundupIndex(null, load, now);
    const one = await index.search(
      "美脚",
      "title",
      archiveCursor("2010-01"),
      "2010-01-01",
      "2010-01-31",
    );
    expect(one.archive.cursor).toBe("2010-01:2:0");
    const two = await index.search(
      "美脚",
      "title",
      one.archive.cursor!,
      "2010-01-01",
      "2010-01-31",
    );
    expect(two.articles).toEqual([old]);
    expect(two.archive.complete).toBe(true);
    expect(load.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ["hamusoku", 1],
      ["alfalfa", 1],
      ["hamusoku", 2],
    ]);
  });
  it("persists unfiltered metadata once and reuses it for other queries and cold instances", async () => {
    const storage = store();
    const load = vi.fn(async () => ({ articles: [old], next: false }));
    await new RoundupIndex(storage, load, now).search(
      "美脚",
      "title",
      "2010-01:1:0",
      "2010-01-01",
      "2010-01-31",
    );
    const next = await new RoundupIndex(storage, load, now).search(
      "過去記事",
      "title",
      "2010-01:1:0",
      "2010-01-01",
      "2010-01-31",
    );
    expect(next.articles).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not declare completion or skip failed source pages", async () => {
    const index = new RoundupIndex(
      null,
      async () => {
        throw Error("network");
      },
      now,
    );
    const r = await index.search(
      "美脚",
      "title",
      "2010-01:1:1",
      "2010-01-01",
      "2010-01-31",
    );
    expect(r.archive).toMatchObject({
      complete: false,
      failed: true,
      cursor: "2010-01:1:1",
    });
  });
  it("restricts date ranges, query matching and cursor targets", async () => {
    expect(() =>
      parseArchiveCursor("2004-12:1:1", "2005-01", "2026-11"),
    ).toThrow();
    expect(() =>
      parseArchiveCursor("2026-11:0:0", "2005-01", "2026-11"),
    ).toThrow();
    const i = new RoundupIndex(
      null,
      async () => ({
        articles: [
          old,
          article(124, {
            title: "無関係",
            publishedAt: "2010-01-15T00:00:00Z",
          }),
        ],
        next: false,
      }),
      now,
    );
    expect(
      (
        await i.search(
          "美脚",
          "title",
          "2010-01:1:0",
          "2010-01-11",
          "2010-01-31",
        )
      ).articles,
    ).toHaveLength(0);
  });
  it("keeps unreadable bodies unknown, rather than including recommendation-only matches", async () => {
    const i = new RoundupIndex(
      null,
      async () => ({ articles: [{ ...old, title: "別の話" }], next: false }),
      now,
      async () => null,
    );
    const r = await i.search(
      "美脚",
      "body",
      "2010-01:1:0",
      "2010-01-01",
      "2010-01-31",
    );
    expect(r.articles).toHaveLength(0);
    expect(r.unverifiedCount).toBe(1);
  });
  it("only treats a real missing month as empty, not upstream errors", async () => {
    expect(
      await fetchArchivePage(
        "hamusoku",
        "2010-01",
        1,
        async () => new Response("", { status: 404 }),
      ),
    ).toEqual({ articles: [], next: false });
    await expect(
      fetchArchivePage(
        "hamusoku",
        "2010-01",
        1,
        async () => new Response("", { status: 503 }),
      ),
    ).rejects.toThrow();
  });
  it("validates archive month and does not follow an external next link", () => {
    const html = `<title>ハムスター速報 : 2010年01月</title><div class="article-outer"><abbr class="updated" title="2010-01-10T09:00:00+09:00"></abbr><h1 class="article-title"><a href="${old.id}">${old.title}</a></h1></div><a href="https://evil.example/archives/2010-01.html?p=2">次</a>`;
    expect(parseArchivePage(html, "hamusoku", "2010-01", 1)).toMatchObject({
      articles: [{ id: old.id, title: old.title }],
      next: false,
    });
    expect(() => parseArchivePage(html, "hamusoku", "2010-02", 1)).toThrow();
  });
});

it("checkpoints background indexing and resumes at the next month rather than starting over", async () => {
  const storage = store();
  let clock = now();
  const load = vi.fn(async () => ({ articles: [], next: false }));
  const first = await new RoundupIndex(storage, load, () => clock).record();
  expect(first.cursor).toBe("2026-07:1:1");
  clock += 4000;
  const second = await new RoundupIndex(storage, load, () => clock).record();
  expect(second.cursor).toBe("2026-03:1:1");
});

import {
  SearchService,
  MemorySearchCache,
  handleSearch,
} from "../server/search";
import { roundupIndex } from "../server/roundup-index";
it("registers only returned archive matches for reader authorization and rejects out-of-range cursors", async () => {
  const search = vi.spyOn(roundupIndex, "search").mockResolvedValue({
    query: "美脚",
    scope: "title",
    articles: [old],
    collection: "search:" + "a".repeat(64),
    candidateCount: 1,
    unverifiedCount: 0,
    excludedCount: 0,
    sources: [
      {
        id: "hamusoku",
        status: "ok",
        fetchedAt: new Date(now()).toISOString(),
      },
    ],
    archive: {
      cursor: null,
      month: "2010-01",
      complete: true,
      failed: false,
      from: "2010-01-01",
      to: "2010-01-31",
      pages: 1,
    },
    generatedAt: new Date(now()).toISOString(),
  });
  try {
    const service = new SearchService(
      new MemorySearchCache(),
      async () => ({ articles: [], hasNext: false }),
      now,
      async () => ({}),
    );
    const data = await service.getArchive(
      "美脚",
      "title",
      undefined,
      "2010-01-01",
      "2010-01-31",
    );
    expect(await service.findKnown(old.id, data.collection)).toEqual(old);
    expect(
      await service.findKnown(article(333).id, data.collection),
    ).toBeUndefined();
    const response = await handleSearch(
      new Request(
        "https://app.test/api/search?q=test&archive=1&cursor=2004-12:1:1",
      ),
      service,
    );
    expect(response.status).toBe(400);
  } finally {
    search.mockRestore();
  }
});

it("uses the canonical first-page URL and retains only failed source positions", async () => {
  const fetcher = vi.fn(
    async (_url: string | URL | Request) => new Response("", { status: 404 }),
  );
  await fetchArchivePage("alfalfa", "2025-01", 1, fetcher);
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://alfalfalfa.com/archives/2025-01.html",
  );
  const index = new RoundupIndex(
    null,
    async (source) => {
      if (source === "alfalfa") throw Error("network");
      return { articles: [], next: false };
    },
    now,
  );
  const r = await index.search(
    "美脚",
    "title",
    "2025-01:1:1",
    "2025-01-01",
    "2025-01-31",
  );
  expect(r.archive).toMatchObject({
    failed: true,
    complete: false,
    cursor: "2025-01:0:1",
  });
});
