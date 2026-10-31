import { z } from "zod";
import { articleSchema } from "./model";
import { yahooArticleSchema } from "./yahoo-model";
import { STORAGE_KEY, loadPreferences } from "./storage";

const YAHOO_KEY = "romnoa:yahoo-library:v1";
const yahooLibrarySchema = z.object({
  saved: z.array(yahooArticleSchema).max(200),
  read: z
    .record(z.string().max(200), z.number().finite())
    .refine((r) => Object.keys(r).length <= 1000),
});
const transferSchema = z.object({
  format: z.literal("romnoa-bookmarks"),
  version: z.literal(1),
  roundup: z.array(articleSchema).max(200),
  news: z.array(yahooArticleSchema).max(200),
});
function current() {
  const prefs = loadPreferences();
  if (prefs.warning) throw Error("保存データを読み取れませんでした。");
  let yahoo: z.infer<typeof yahooLibrarySchema>;
  try {
    const raw = localStorage.getItem(YAHOO_KEY);
    yahoo = raw
      ? yahooLibrarySchema.parse(JSON.parse(raw))
      : { saved: [], read: {} };
  } catch {
    throw Error("ニュースの保存データを読み取れませんでした。");
  }
  return { prefs: prefs.value, yahoo };
}
export function exportBookmarks() {
  const { prefs, yahoo } = current();
  return JSON.stringify({
    format: "romnoa-bookmarks",
    version: 1,
    roundup: prefs.saved,
    news: yahoo.saved,
  });
}
export function importBookmarks(raw: string) {
  if (raw.length > 2_000_000) throw Error("データが大きすぎます。");
  let data: z.infer<typeof transferSchema>;
  try {
    data = transferSchema.parse(JSON.parse(raw));
  } catch {
    throw Error(
      "引き継ぎデータを読み取れませんでした。元のデータをもう一度お試しください。",
    );
  }
  const { prefs, yahoo } = current();
  const merge = <T extends { id: string }>(existing: T[], incoming: T[]) => {
    const map = new Map(existing.map((item) => [item.id, item]));
    for (const item of incoming) if (!map.has(item.id)) map.set(item.id, item);
    return [...map.values()];
  };
  const roundup = merge(prefs.saved, data.roundup),
    news = merge(yahoo.saved, data.news);
  if (roundup.length > 200 || news.length > 200)
    throw Error(
      "保存上限（まとめ・ニュース各200件）を超えるため取り込めません。保存数を減らしてからお試しください。",
    );
  const previousPrefs = localStorage.getItem(STORAGE_KEY),
    previousYahoo = localStorage.getItem(YAHOO_KEY);
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prefs, saved: roundup }),
    );
    localStorage.setItem(YAHOO_KEY, JSON.stringify({ ...yahoo, saved: news }));
  } catch {
    try {
      if (previousPrefs === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, previousPrefs);
    } catch {
      /* best-effort rollback */
    }
    try {
      if (previousYahoo === null) localStorage.removeItem(YAHOO_KEY);
      else localStorage.setItem(YAHOO_KEY, previousYahoo);
    } catch {
      /* best-effort rollback */
    }
    throw Error(
      "端末に保存できませんでした。空き容量やブラウザの設定を確認してください。",
    );
  }
  return {
    prefs: { ...prefs, saved: roundup },
    roundup: roundup.length,
    news: news.length,
  };
}
