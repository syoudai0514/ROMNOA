import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportBookmarks, importBookmarks } from "../src/lib/bookmark-transfer";
import { defaults, STORAGE_KEY } from "../src/lib/storage";
import { article } from "./fixtures";

const key = "romnoa:yahoo-library:v1";
const news = (id: string) => ({
  id: `https://news.yahoo.co.jp/articles/${id.repeat(40)}`,
  url: `https://news.yahoo.co.jp/articles/${id.repeat(40)}`,
  title: `ニュース ${id}`,
  summary: "",
  image: null,
  category: "domestic",
  publishedAt: null,
});
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, String(v)),
    removeItem: (k: string) => data.delete(k),
  });
});
describe("bookmark transfer", () => {
  it("merges both bookmark libraries without replacing settings, read history or duplicates", () => {
    data.set(
      STORAGE_KEY,
      JSON.stringify({ ...defaults, saved: [article(1)], theme: "dark" }),
    );
    data.set(
      key,
      JSON.stringify({ saved: [news("a")], read: { "read-id": 123 } }),
    );
    const saved = exportBookmarks();
    data.set(
      STORAGE_KEY,
      JSON.stringify({
        ...defaults,
        saved: [article(2)],
        theme: "light",
        read: { existing: 42 },
      }),
    );
    data.set(
      key,
      JSON.stringify({ saved: [news("b"), news("a")], read: { other: 222 } }),
    );
    const result = importBookmarks(saved);
    expect(result.prefs.saved.map((a) => a.id)).toEqual([
      article(2).id,
      article(1).id,
    ]);
    expect(result.prefs.theme).toBe("light");
    expect(result.prefs.read).toEqual({ existing: 42 });
    expect(
      JSON.parse(data.get(key)!).saved.map((a: { id: string }) => a.id),
    ).toEqual([news("b").id, news("a").id]);
    expect(JSON.parse(data.get(key)!).read).toEqual({ other: 222 });
  });
  it("rejects malformed data and over-limit merges without changing either library", () => {
    data.set(
      STORAGE_KEY,
      JSON.stringify({
        ...defaults,
        saved: Array.from({ length: 200 }, (_, i) => article(i)),
      }),
    );
    data.set(key, JSON.stringify({ saved: [news("a")], read: {} }));
    const before = new Map(data);
    expect(() => importBookmarks("{broken")).toThrow();
    expect(() =>
      importBookmarks(
        JSON.stringify({
          format: "romnoa-bookmarks",
          version: 1,
          roundup: [article(201)],
          news: [],
        }),
      ),
    ).toThrow(/上限/);
    expect(data).toEqual(before);
  });
});
