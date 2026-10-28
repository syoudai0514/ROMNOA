import { z } from "zod";

export const categories = [
  "すべて",
  "ニュース",
  "暮らし",
  "エンタメ",
  "ゲーム",
  "テクノロジー",
  "話題",
] as const;
export type Category = (typeof categories)[number];
export const sourceInfo = [
  {
    id: "hamusoku",
    name: "ハムスター速報",
    short: "ハ",
    color: "#b27a43",
    url: "https://hamusoku.com/",
  },
  {
    id: "alfalfa",
    name: "アルファルファモザイク",
    short: "ア",
    color: "#567e72",
    url: "https://alfalfalfa.com/",
  },
] as const;
export const articleSchema = z
  .object({
    id: z.string().max(2048),
    url: z
      .url()
      .max(2048)
      .refine((s) => {
        const u = new URL(s);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.port &&
          sourceInfo.some((x) => new URL(x.url).hostname === u.hostname)
        );
      }),
    sourceId: z.enum(["hamusoku", "alfalfa"]),
    title: z.string().min(1).max(300),
    publishedAt: z.iso.datetime().nullable(),
    category: z.enum(
      categories.slice(1) as [
        Exclude<Category, "すべて">,
        ...Exclude<Category, "すべて">[],
      ],
    ),
  })
  .refine(
    (a) =>
      a.id === a.url &&
      new URL(a.url).hostname ===
        new URL(sourceInfo.find((s) => s.id === a.sourceId)!.url).hostname,
  );
export type Article = z.infer<typeof articleSchema>;
export const feedResponseSchema = z.object({
  articles: z.array(articleSchema).max(200),
  sources: z
    .array(
      z.object({
        id: z.enum(["hamusoku", "alfalfa"]),
        status: z.enum(["ok", "cached", "error"]),
        fetchedAt: z.iso.datetime().nullable(),
      }),
    )
    .max(2),
  generatedAt: z.iso.datetime(),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;
export type Sort = "newest" | "unread" | "category" | "popular";

export function classify(text: string): Article["category"] {
  if (/ゲーム|ポケモン|ドラクエ|任天堂|PS5|スイッチ|モンハン/i.test(text))
    return "ゲーム";
  if (/AI|スマホ|iPhone|PC|パソコン|テクノ|アプリ|プログラ|半導体/i.test(text))
    return "テクノロジー";
  if (/アニメ|漫画|芸能|映画|音楽|声優|ワンピース|アイドル/.test(text))
    return "エンタメ";
  if (
    /生活|料理|仕事|会社|給料|職|育児|結婚|恋愛|医者|上司|残業|ご飯|食べ|家族/.test(
      text,
    )
  )
    return "暮らし";
  if (/ニュース|政治|選挙|経済|事件|警察|首相|政府|事故|国会/.test(text))
    return "ニュース";
  return "話題";
}

export function newest(a: Article, b: Article) {
  return (
    (b.publishedAt ? Date.parse(b.publishedAt) : 0) -
      (a.publishedAt ? Date.parse(a.publishedAt) : 0) ||
    a.id.localeCompare(b.id)
  );
}

export function filterArticles(
  articles: Article[],
  options: {
    category: Category;
    query: string;
    hiddenSources: string[];
    ngWords: string[];
    sort: Sort;
    read: Record<string, number>;
    ranks?: Record<string, number>;
  },
) {
  const query = options.query.normalize("NFKC").trim().toLocaleLowerCase();
  return articles
    .filter((a) => {
      const text = a.title.normalize("NFKC").toLocaleLowerCase();
      return (
        (options.sort !== "popular" || options.ranks?.[a.id] !== undefined) &&
        !options.hiddenSources.includes(a.sourceId) &&
        (options.category === "すべて" || a.category === options.category) &&
        (!query ||
          text.includes(query) ||
          sourceInfo
            .find((s) => s.id === a.sourceId)!
            .name.toLowerCase()
            .includes(query)) &&
        !options.ngWords.some((w) =>
          text.includes(w.normalize("NFKC").trim().toLocaleLowerCase()),
        )
      );
    })
    .sort((a, b) => {
      if (options.sort === "popular")
        return (
          sourceInfo.findIndex((s) => s.id === a.sourceId) -
            sourceInfo.findIndex((s) => s.id === b.sourceId) ||
          options.ranks![a.id] - options.ranks![b.id]
        );
      if (options.sort === "unread")
        return (
          Number(!!options.read[a.id]) - Number(!!options.read[b.id]) ||
          newest(a, b)
        );
      if (options.sort === "category")
        return (
          categories.indexOf(a.category) - categories.indexOf(b.category) ||
          newest(a, b)
        );
      return newest(a, b);
    });
}

function grams(text: string) {
  const s = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/【[^】]*】|[\p{P}\p{Z}\sｗw]/gu, "");
  return new Set(
    Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
      s.slice(i, i + 2),
    ),
  );
}
export function similar(a: Article, b: Article) {
  if (
    !a.publishedAt ||
    !b.publishedAt ||
    Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) > 86_400_000
  )
    return false;
  const x = grams(a.title),
    y = grams(b.title);
  if (x.size < 8 || y.size < 8) return false;
  let common = 0;
  x.forEach((g) => {
    if (y.has(g)) common++;
  });
  return (2 * common) / (x.size + y.size) >= 0.88;
}
export function groupArticles(articles: Article[], enabled: boolean) {
  const groups: Article[][] = [];
  for (const a of articles) {
    const group = enabled ? groups.find((g) => similar(g[0], a)) : undefined;
    if (group) group.push(a);
    else groups.push([a]);
  }
  return groups;
}

export function articleDate(value: string | null) {
  if (!value) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}
