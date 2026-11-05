import { describe, expect, it } from "vitest";
import { NewsArchive, type ArchiveStore } from "../server/news-archive";
import { handleYahoo } from "../server/yahoo";
import { yahooCategories, type YahooArticle } from "../src/lib/yahoo-model";

function memoryStore() {
  const files = new Map<string, string>();
  const store: ArchiveStore = {
    async write(p, b) { files.set(p, b); },
    async paths(prefix) { return [...files.keys()].filter((p) => p.startsWith(prefix)); },
    async read(p) { return files.get(p) ?? null; },
    async remove(ps) { ps.forEach((p) => files.delete(p)); },
  };
  return { files, store };
}
const item = (n: number, publishedAt: string): YahooArticle => {
  const id = `https://news.yahoo.co.jp/articles/${n.toString(16).padStart(40, "0")}`;
  return { id, url: id, title: `ニュース ${n}`, summary: "冒頭", image: null, category: "domestic", publishedAt };
};

describe("ROMNOA's day record of Yahoo! News", () => {
  it("records each run in its own file and returns a day newest first", async () => {
    let now = Date.parse("2026-11-05T03:00:00Z");
    const { files, store } = memoryStore();
    const archive = new NewsArchive(store, () => now);
    expect(await archive.record([item(1, "2026-11-05T01:00:00Z"), item(2, "2026-11-05T02:00:00Z")])).toBe(2);
    // The same items again write nothing; a new one writes one file.
    expect(await archive.record([item(1, "2026-11-05T01:00:00Z")])).toBe(0);
    now += 900_000;
    await archive.record([item(1, "2026-11-05T01:00:00Z"), item(3, "2026-11-05T03:10:00Z")]);
    expect([...files.keys()].filter((p) => p.startsWith("yahoo-news/2026-11-05/"))).toHaveLength(2);
    expect((await archive.day("2026-11-05")).map((a) => a.title)).toEqual(["ニュース 3", "ニュース 2", "ニュース 1"]);
  });
  it("files items under their Japan-time day and merges a finished day into one file", async () => {
    let now = Date.parse("2026-11-04T16:00:00Z"); // 11/5 01:00 JST
    const { files, store } = memoryStore();
    const archive = new NewsArchive(store, () => now);
    await archive.record([item(4, "2026-11-04T14:30:00Z"), item(5, "2026-11-04T15:30:00Z")]);
    expect([...files.keys()].some((p) => p.startsWith("yahoo-news/2026-11-04/"))).toBe(true);
    expect([...files.keys()].some((p) => p.startsWith("yahoo-news/2026-11-05/"))).toBe(true);
    now = Date.parse("2026-11-05T05:00:00Z");
    expect((await archive.day("2026-11-04")).map((a) => a.title)).toEqual(["ニュース 4"]);
    expect([...files.keys()].filter((p) => p.startsWith("yahoo-news/2026-11-04/"))).toEqual(["yahoo-news/2026-11-04/all.json"]);
    expect(await archive.firstDay()).toBe("2026-11-04");
  });
  it("serves a past day from the record and rejects days outside it", async () => {
    const archive = { day: async () => [item(6, "2026-11-04T01:00:00Z")], firstDay: async () => "2026-11-03" };
    const live = { get: async () => ({ articles: [], sources: yahooCategories.map((c) => ({ id: c.id, status: "ok" as const, fetchedAt: null })), generatedAt: new Date().toISOString() }) };
    const yesterday = new Date(Date.now() + 9 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
    const res = await handleYahoo(new Request(`https://app/api/yahoo?date=${yesterday}`), live, archive);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ date: yesterday, firstDay: "2026-11-03" });
    expect(body.articles).toHaveLength(1);
    expect((await handleYahoo(new Request("https://app/api/yahoo?date=2020-01-01"), live, archive)).status).toBe(400);
    expect((await handleYahoo(new Request("https://app/api/yahoo?x=1"), live, archive)).status).toBe(400);
  });
});

describe("the scheduled refresh", () => {
  it("shares /api/yahoo as ?record=1 and only refreshes the feeds", async () => {
    let calls = 0;
    const live = { get: async () => { calls++; return { articles: [], sources: yahooCategories.map((c) => ({ id: c.id, status: "ok" as const, fetchedAt: null })), generatedAt: new Date().toISOString() }; } };
    const res = await handleYahoo(new Request("https://app/api/yahoo?record=1"), live, null);
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expect((await handleYahoo(new Request("https://app/api/yahoo?record=1&date=x"), live, null)).status).toBe(400);
  });
});
