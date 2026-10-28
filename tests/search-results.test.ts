import { describe, it, expect } from "vitest";
import {
  appendSearchPage,
  mergeLocalSearch,
  searchDay,
} from "../src/lib/search-results";
import { searchResponseSchema } from "../src/lib/search-model";
import { filterArticles } from "../src/lib/model";
import { article, feed } from "./fixtures";

const a = article(9501, {
  title: "検索対象の話",
  publishedAt: "2026-01-01T00:00:00Z",
});
const b = article(9502, {
  title: "検索対象の続き",
  publishedAt: "2010-01-01T00:00:00Z",
});
const page = (n: number, articles = [a]) =>
  searchResponseSchema.parse({
    ...feed,
    articles,
    bookmarks: Object.fromEntries(articles.map((a) => [a.id, 0])),
    query: "検索対象",
    page: n,
    collection: `search:${String(n).repeat(64)}`,
    nextSources: ["hamusoku"],
    candidateCount: 50,
    excludedCount: 48,
    searchedRange: {
      from: n === 1 ? a.publishedAt : b.publishedAt,
      to: a.publishedAt,
    },
  });
describe("cumulative historical search", () => {
  it("keeps earlier stories, deduplicates IDs, merges measured zero and range from all inspected candidates", () => {
    const result = appendSearchPage(page(1), page(2, [a, b]));
    expect(result.articles.map((a) => a.id)).toEqual([a.id, b.id]);
    expect(result).toMatchObject({
      page: 2,
      candidateCount: 100,
      excludedCount: 96,
      searchedRange: { from: b.publishedAt, to: a.publishedAt },
    });
    expect(result.bookmarks).toEqual({ [a.id]: 0, [b.id]: 0 });
    expect(result.sources).toHaveLength(2);
  });
  it("never mixes queries, scopes or repeated pages, and never makes up unavailable popularity", () => {
    expect(() =>
      appendSearchPage(page(1), { ...page(2), query: "別" }),
    ).toThrow();
    expect(() =>
      appendSearchPage(page(1), { ...page(2), scope: "body" }),
    ).toThrow();
    expect(() => appendSearchPage(page(1), page(1))).toThrow();
    expect(
      appendSearchPage(page(1), { ...page(2), bookmarks: null }).bookmarks,
    ).toBeNull();
  });
  it("includes matching saved/history titles with unknown dates but excludes unrelated titles and preserves remote metadata", () => {
    const unknown = article(9503, {
      title: "検索対象の保存記事",
      publishedAt: null,
    });
    const list = mergeLocalSearch(
      [a],
      [
        a,
        { ...a, publishedAt: null },
        unknown,
        unknown,
        article(9504, { title: "関係ない記事" }),
      ],
      "検索対象",
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual(a);
    expect(list[1]).toEqual(unknown);
    expect(mergeLocalSearch([], [a], "検索対象 未一致")).toEqual([]);
    expect(mergeLocalSearch([], [a], "")).toEqual([]);
  });
  it("keeps unmeasured local results after genuinely measured zero in popular search without inventing a score", () => {
    const result = filterArticles([b, a], {
      category: "すべて",
      query: "",
      hiddenSources: [],
      ngWords: [],
      sort: "popular",
      read: {},
      popularity: { [a.id]: 0 },
      includeUnmeasured: true,
    });
    expect(result.map((a) => a.id)).toEqual([a.id, b.id]);
    expect(
      filterArticles([b, a], {
        category: "すべて",
        query: "",
        hiddenSources: [],
        ngWords: [],
        sort: "popular",
        read: {},
        popularity: { [a.id]: 0 },
      }),
    ).toEqual([a]);
  });
  it("formats the verified date range in Japan time without pretending an unknown date is recent", () => {
    expect(searchDay("2024-01-01T16:00:00Z")).toBe("2024-01-02");
    expect(searchDay(null)).toBe("不明");
  });
});
