import { describe, expect, it } from "vitest";
import { filterArticles, groupArticles, type Category } from "../src/lib/model";
import { defaults, markRead } from "../src/lib/storage";
import { article, feed } from "./fixtures";
const options = {
  category: "すべて" as Category,
  query: "",
  hiddenSources: [] as string[],
  ngWords: [] as string[],
  sort: "newest" as const,
  read: {},
};
describe("Personalization and discovery (R03/R06/R09/R13/R14)", () => {
  it("combines search, category, source and NG filters", () => {
    expect(
      filterArticles(feed.articles, {
        ...options,
        query: "休日の料理",
        category: "暮らし",
      }),
    ).toHaveLength(1);
    expect(
      filterArticles(feed.articles, {
        ...options,
        hiddenSources: ["hamusoku"],
      }),
    ).toHaveLength(1);
    expect(
      filterArticles(feed.articles, { ...options, ngWords: ["ゲーム"] }).some(
        (a) => a.category === "ゲーム",
      ),
    ).toBe(false);
    expect(
      filterArticles(feed.articles, {
        ...options,
        query: "スマートフォン",
        ngWords: ["スマートフォン"],
      }),
    ).toHaveLength(0);
  });
  it("prioritizes unread while keeping chronological order within each group", () => {
    const result = filterArticles(feed.articles.slice(0, 3), {
      ...options,
      sort: "unread",
      read: { [feed.articles[0].id]: 1 },
    });
    expect(result.map((a) => a.id)).toEqual([
      feed.articles[1].id,
      feed.articles[2].id,
      feed.articles[0].id,
    ]);
  });
  it("bounds read history, keeps most recent and avoids duplicate entries", () => {
    let p = defaults;
    for (let i = 0; i < 510; i++) p = markRead(p, article(i), i + 1);
    expect(p.history).toHaveLength(500);
    expect(Object.keys(p.read)).toHaveLength(500);
    p = markRead(p, article(509), 1000);
    expect(p.history).toHaveLength(500);
    expect(p.history[0].at).toBe(1000);
  });
  it("groups close titles only within a day and can be disabled", () => {
    const one = article(1, {
      title: "【話題】新しい図書館の便利な使い方が話題になっている",
    });
    const two = article(2, {
      title: "【注目】新しい図書館の便利な使い方が話題になっている！",
    });
    expect(groupArticles([one, two], true)).toHaveLength(1);
    expect(groupArticles([one, two], false)).toHaveLength(2);
    expect(
      groupArticles(
        [one, { ...two, publishedAt: "2025-01-01T00:00:00.000Z" }],
        true,
      ),
    ).toHaveLength(2);
  });
});
