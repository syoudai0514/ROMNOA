// ROMNOA's own day-by-day record of Yahoo! News RSS items. Yahoo publishes
// only the latest ~50 items per category, so earlier 新着 of a day exist
// only because ROMNOA saw them. Each recording run writes its own file
// (no two writers touch one file); a finished day is merged into one file
// the first time it is read. 21 days are kept.
import { put, list, get, del } from "@vercel/blob";
import { z } from "zod";
import { yahooArticleSchema, type YahooArticle } from "../src/lib/yahoo-model.js";
import { japanDay, shiftDay, validDay } from "../src/lib/discovery-model.js";

export const KEEP_DAYS = 21;
const ROOT = "yahoo-news/";
const itemsSchema = z.array(yahooArticleSchema).max(5000);

export interface ArchiveStore {
  write(path: string, body: string): Promise<void>;
  // Pathnames under a prefix.
  paths(prefix: string): Promise<string[]>;
  read(path: string): Promise<string | null>;
  remove(paths: string[]): Promise<void>;
}
export const blobStore: ArchiveStore = {
  async write(path, body) {
    await put(path, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  },
  async paths(prefix) {
    const out: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await list({ prefix, limit: 1000, cursor });
      out.push(...page.blobs.map((b) => b.pathname));
      if (!page.hasMore || !page.cursor) break;
      cursor = page.cursor;
    }
    return out;
  },
  async read(path) {
    const r = await get(path, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return await new Response(r.stream).text();
  },
  async remove(paths) {
    if (paths.length) await del(paths);
  },
};
export const archiveConfigured = () => !!process.env.BLOB_STORE_ID || !!process.env.BLOB_READ_WRITE_TOKEN;

const dayOf = (a: YahooArticle, now: number) => japanDay(a.publishedAt ? Date.parse(a.publishedAt) : now);
const compact = (a: YahooArticle): YahooArticle => ({ ...a, summary: a.summary.slice(0, 300) });
const newestFirst = (a: YahooArticle, b: YahooArticle) =>
  (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0);

export class NewsArchive {
  // Items this instance has already written, so a run writes only news.
  private written = new Map<string, number>();
  private days = new Map<string, { articles: YahooArticle[]; at: number }>();
  constructor(
    private store: ArchiveStore = blobStore,
    private now = Date.now,
  ) {}
  // Record the items of one RSS fetch. Returns how many were new here.
  async record(articles: YahooArticle[]) {
    const now = this.now();
    const fresh = articles.filter((a) => !this.written.has(a.id));
    if (!fresh.length) return 0;
    const byDay = new Map<string, YahooArticle[]>();
    for (const a of fresh) {
      const day = dayOf(a, now);
      if (day < shiftDay(japanDay(now), -1)) continue; // RSS stragglers
      byDay.set(day, [...(byDay.get(day) ?? []), compact(a)]);
    }
    const run = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    for (const [day, items] of byDay)
      await this.store.write(`${ROOT}${day}/run-${run}.json`, JSON.stringify(items));
    for (const a of fresh) this.written.set(a.id, now);
    if (this.written.size > 5000)
      for (const [id, at] of this.written) if (now - at > 2 * 86_400_000) this.written.delete(id);
    for (const day of byDay.keys()) this.days.delete(day);
    return fresh.length;
  }
  private async merge(paths: string[]) {
    const all = new Map<string, YahooArticle>();
    for (const path of paths) {
      const text = await this.store.read(path);
      if (!text) continue;
      const parsed = itemsSchema.safeParse(JSON.parse(text));
      if (parsed.success) for (const a of parsed.data) if (!all.has(a.id)) all.set(a.id, a);
    }
    return [...all.values()].sort(newestFirst);
  }
  // Every recorded item of one Japan-time day, newest first.
  async day(day: string): Promise<YahooArticle[]> {
    const now = this.now(),
      today = japanDay(now);
    if (!validDay(day, now) || day < shiftDay(today, -(KEEP_DAYS - 1))) return [];
    const cached = this.days.get(day);
    const fresh = day === today ? 120_000 : 3_600_000;
    if (cached && now - cached.at >= 0 && now - cached.at < fresh) return cached.articles;
    const prefix = `${ROOT}${day}/`;
    let articles: YahooArticle[];
    const paths = await this.store.paths(prefix);
    const merged = paths.find((p) => p === `${prefix}all.json`);
    const runs = paths.filter((p) => p !== `${prefix}all.json`);
    if (day < today && merged && !runs.length) articles = await this.merge([merged]);
    else {
      articles = await this.merge(paths);
      // A finished day becomes one file; old days are dropped.
      if (day < today && runs.length) {
        await this.store.write(`${prefix}all.json`, JSON.stringify(articles));
        await this.store.remove(runs);
        await this.prune(today);
      }
    }
    this.days.set(day, { articles, at: now });
    if (this.days.size > 30) this.days.delete(this.days.keys().next().value!);
    return articles;
  }
  // The first day with a record (the day stepper stops there).
  async firstDay(): Promise<string | null> {
    const paths = await this.store.paths(ROOT);
    const days = [...new Set(paths.map((p) => p.slice(ROOT.length, ROOT.length + 10)))].filter((d) => validDay(d)).sort();
    return days[0] ?? null;
  }
  private async prune(today: string) {
    const oldest = shiftDay(today, -(KEEP_DAYS - 1));
    const paths = await this.store.paths(ROOT);
    await this.store.remove(paths.filter((p) => p.slice(ROOT.length, ROOT.length + 10) < oldest));
  }
}
export const newsArchive = new NewsArchive();
