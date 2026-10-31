import { describe, expect, it } from "vitest";
import { yahooSearchDay, inYahooSearchPeriod } from "../src/lib/yahoo-search-date";
import type { YahooArticle } from "../src/lib/yahoo-model";
const id = `https://news.yahoo.co.jp/articles/${"a".repeat(40)}`;
const item: YahooArticle = { id, url: id, title: "テスト", summary: "", image: null, category: "domestic", publishedAt: null };
describe("Yahoo search dates", () => {
  it("uses Japan calendar days for exact timestamps and parses explicitly dated older results", () => {
    expect(yahooSearchDay({ ...item, publishedAt: "2026-10-28T16:00:00Z" })).toBe("2026-10-29");
    expect(yahooSearchDay({ ...item, displayDate: "2016/6/28(火) 12:10" })).toBe("2016-06-28");
    expect(yahooSearchDay({ ...item, displayDate: "2026/2/30(月) 12:00" })).toBeNull();
    expect(yahooSearchDay({ ...item, displayDate: "2026/10/29(金) 12:00" })).toBeNull();
  });
  it("requires corroborating dated Yahoo image metadata for a date without a year", () => {
    const image = "https://newsatcl-pctr.c.yimg.jp/t/amd-img/20261101-00010008-realsound-000-1-view.jpg";
    expect(yahooSearchDay({ ...item, displayDate: "11/1(日) 8:31", image })).toBe("2026-11-01");
    expect(yahooSearchDay({ ...item, displayDate: "11/1(月) 8:31", image })).toBeNull();
    expect(yahooSearchDay({ ...item, displayDate: "11/1(日) 8:31" })).toBeNull();
    const newYear = "https://newsatcl-pctr.c.yimg.jp/t/amd-img/20260101-00000001-test-000-1-view.jpg";
    expect(yahooSearchDay({ ...item, displayDate: "12/31(水) 23:59", image: newYear })).toBe("2025-12-31");
  });
  it("includes both endpoints and excludes dates that cannot be established", () => {
    expect(inYahooSearchPeriod("2026-10-29", "2026-10-29", "2026-10-29")).toBe(true);
    expect(inYahooSearchPeriod("2026-10-28", "2026-10-29", "")).toBe(false);
    expect(inYahooSearchPeriod(null, "2026-10-29", "")).toBe(false);
  });
});
