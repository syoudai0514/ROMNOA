import { z } from "zod";
import { articleSchema, feedResponseSchema, type Article } from "./model";

export const STORAGE_KEY = "romnoa:preferences:v1";
export const FEED_KEY = "romnoa:feed:v1";
const prefsSchema = z.object({
  version: z.literal(1),
  saved: z.array(articleSchema).max(200),
  history: z
    .array(z.object({ article: articleSchema, at: z.number() }))
    .max(500),
  read: z.record(z.string(), z.number()),
  hiddenSources: z.array(z.enum(["hamusoku", "alfalfa"])).max(2),
  ngWords: z.array(z.string().min(1).max(80)).max(50),
  theme: z.enum(["system", "light", "dark"]),
  fontSize: z.enum(["small", "medium", "large"]),
  groupSimilar: z.boolean(),
});
export type Preferences = z.infer<typeof prefsSchema>;
export const defaults: Preferences = {
  version: 1,
  saved: [],
  history: [],
  read: {},
  hiddenSources: [],
  ngWords: [],
  theme: "system",
  fontSize: "medium",
  groupSimilar: true,
};

export function loadPreferences(): { value: Preferences; warning: string } {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return { value: defaults, warning: "" };
    return { value: prefsSchema.parse(JSON.parse(data)), warning: "" };
  } catch {
    return {
      value: defaults,
      warning:
        "端末の保存データを読み込めませんでした。設定を初期状態で開いています。",
    };
  }
}
export function persistPreferences(prefs: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
export function markRead(
  prefs: Preferences,
  article: Article,
  at = Date.now(),
): Preferences {
  return {
    ...prefs,
    read: Object.fromEntries(
      Object.entries({ ...prefs.read, [article.id]: at })
        .sort((a, b) => b[1] - a[1])
        .slice(0, 500),
    ),
    history: [
      { article, at },
      ...prefs.history.filter((h) => h.article.id !== article.id),
    ].slice(0, 500),
  };
}
export function loadFeedCache() {
  try {
    const data = JSON.parse(localStorage.getItem(FEED_KEY) || "null");
    if (
      !data ||
      Date.now() - data.savedAt > 86_400_000 ||
      data.savedAt > Date.now() + 60_000
    )
      return null;
    return feedResponseSchema.parse(data.feed);
  } catch {
    return null;
  }
}
export function saveFeedCache(feed: z.infer<typeof feedResponseSchema>) {
  try {
    localStorage.setItem(
      FEED_KEY,
      JSON.stringify({ feed, savedAt: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}
