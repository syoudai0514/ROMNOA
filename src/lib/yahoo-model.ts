import { z } from "zod";
import { matchesSearch } from "./search-model.js";

export const yahooCategories = [
  { id: "domestic", label: "国内" },
  { id: "world", label: "国際" },
  { id: "business", label: "経済" },
  { id: "entertainment", label: "エンタメ" },
  { id: "sports", label: "スポーツ" },
  { id: "it", label: "IT" },
  { id: "science", label: "科学" },
  { id: "life", label: "暮らし" },
  { id: "local", label: "地域" },
] as const;
export const yahooCategorySchema = z.enum(yahooCategories.map((c) => c.id));
export type YahooCategory = z.infer<typeof yahooCategorySchema>;

export function yahooArticleUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "news.yahoo.co.jp" ||
      u.username ||
      u.password ||
      u.port ||
      u.hash ||
      !/^\/articles\/[a-f0-9]{40}$/.test(u.pathname) ||
      [...u.searchParams].some(([k, v]) => k !== "source" || v !== "rss")
    )
      return null;
    u.search = "";
    return u.href;
  } catch {
    return null;
  }
}
export function yahooImageUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" &&
      u.hostname === "newsatcl-pctr.c.yimg.jp" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      /^\/t\/amd-img\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(
        u.pathname,
      )
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export const yahooArticleSchema = z
  .object({
    id: z.string().max(200),
    url: z.string().max(200),
    title: z.string().min(1).max(500),
    summary: z.string().max(2000),
    image: z
      .string()
      .max(2048)
      .nullable()
      .refine((s) => s === null || yahooImageUrl(s) === s),
    category: yahooCategorySchema,
    publishedAt: z.iso.datetime().nullable(),
  })
  .refine((a) => a.id === a.url && yahooArticleUrl(a.url) === a.url);
export type YahooArticle = z.infer<typeof yahooArticleSchema>;
export const yahooResponseSchema = z.object({
  articles: z.array(yahooArticleSchema).max(450),
  sources: z
    .array(
      z.object({
        id: yahooCategorySchema,
        status: z.enum(["ok", "cached", "error"]),
        fetchedAt: z.iso.datetime().nullable(),
      }),
    )
    .max(9),
  generatedAt: z.iso.datetime(),
});
export type YahooResponse = z.infer<typeof yahooResponseSchema>;
export function filterYahoo(
  articles: YahooArticle[],
  query: string,
  scope: "title" | "summary",
  category: string,
) {
  return articles
    .filter(
      (a) =>
        (category === "all" || a.category === category) &&
        (!query.trim() ||
          matchesSearch(
            scope === "title" ? a.title : `${a.title}\n${a.summary}`,
            query,
          )),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.publishedAt || "") || 0) -
          (Date.parse(a.publishedAt || "") || 0) || a.id.localeCompare(b.id),
    );
}
