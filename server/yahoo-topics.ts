import { XMLParser, XMLValidator } from "fast-xml-parser";
import { getCache } from "@vercel/functions";
import { yahooArticleUrl, yahooArticleSchema, type YahooArticle } from "../src/lib/yahoo-model.js";
import { japanDay, shiftDay, validDay } from "../src/lib/discovery-model.js";

// Yahoo's topic list keeps about a week; a date further back is not offered.
export const TOPIC_DAYS = 7;
export function validTopicDay(day: string, now = Date.now()) {
  const today = japanDay(now);
  return validDay(day, now) && day >= shiftDay(today, -(TOPIC_DAYS - 1)) && day <= today;
}
const LIST = "https://news.yahoo.co.jp/topics/top-picks";
const PAGE_LIMIT = 2_000_000;
const MAX_PAGES = 30;
// One page of the public topic list: each topic names its Yahoo article
// (contentId) and when it was published. Nothing else on the page is read.
export function parseTopicListPage(html: string) {
  if (Buffer.byteLength(html) > PAGE_LIMIT) throw Error("topics_page_too_large");
  const raw = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/)?.[1];
  if (!raw) throw Error("topics_structure_changed");
  const list = JSON.parse(raw)?.topicsList?.list;
  if (!Array.isArray(list)) throw Error("topics_structure_changed");
  return list.slice(0, 60).flatMap((item: Record<string, unknown>) => {
    const id = typeof item.contentId === "string" ? item.contentId : "";
    const url =
      item.contentIdType === "shannon_article" && /^[a-f0-9]{40}$/.test(id)
        ? yahooArticleUrl(`https://news.yahoo.co.jp/articles/${id}`)
        : null;
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 500) : "";
    const time = typeof item.publishedTime === "string" ? Date.parse(item.publishedTime) : NaN;
    if (!url || !title || !Number.isFinite(time)) return [];
    return [
      yahooArticleSchema.parse({
        id: url,
        url,
        title,
        summary: "",
        image: null,
        category: "domestic",
        origin: "topic",
        publishedAt: new Date(time).toISOString(),
      }),
    ];
  });
}
async function readText(response: Response, limit: number) {
  if (!response.body) throw Error("unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
// All topics of one Japan-time day, read from the list's pages (newest
// first) until a page ends before that day. Four pages are read at a time.
export async function topicsForDay(day: string, fetcher: typeof fetch = fetch) {
  const start = Date.parse(`${day}T00:00:00+09:00`),
    end = start + 86_400_000;
  const found = new Map<string, YahooArticle>();
  for (let first = 1; first <= MAX_PAGES; first += 4) {
    const pages = await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        const n = first + i;
        if (n > MAX_PAGES) return null;
        const res = await fetcher(n === 1 ? LIST : `${LIST}?page=${n}`, {
          redirect: "error",
          signal: AbortSignal.timeout(8000),
          headers: { "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)", Accept: "text/html" },
        });
        if (res.status === 404) {
          await res.body?.cancel();
          return null;
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw Error("topics_unavailable");
        }
        return parseTopicListPage(await readText(res, PAGE_LIMIT));
      }),
    );
    let past = false;
    for (const page of pages) {
      if (!page) {
        past = true;
        break;
      }
      for (const a of page) {
        const t = Date.parse(a.publishedAt!);
        if (t >= start && t < end && !found.has(a.id)) found.set(a.id, a);
      }
      if (page.length && page.every((a) => Date.parse(a.publishedAt!) < start)) past = true;
    }
    if (past) break;
  }
  return [...found.values()]
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))
    .slice(0, 200);
}
type DayEntry = { articles: YahooArticle[]; at: number };
const memory = new Map<string, DayEntry>();
const runtime = () => (process.env.VERCEL ? getCache({ namespace: "romnoa-yahoo-topic-days-v1" }) : null);
// Today's list changes; a finished day is stable.
const freshFor = (day: string, now: number) => (day === japanDay(now) ? 600_000 : 3_600_000);
async function cachedTopicsForDay(day: string, fetcher: typeof fetch, now = Date.now()) {
  const hit = memory.get(day);
  if (hit && now - hit.at >= 0 && now - hit.at < freshFor(day, now)) return hit.articles;
  try {
    const stored = (await runtime()?.get(day)) as DayEntry | undefined;
    if (stored && Array.isArray(stored.articles) && now - stored.at >= 0 && now - stored.at < freshFor(day, now)) {
      const articles = stored.articles.map((a) => yahooArticleSchema.parse(a));
      memory.set(day, { articles, at: stored.at });
      return articles;
    }
  } catch {
    /* fetch again */
  }
  const articles = await topicsForDay(day, fetcher);
  const entry = { articles, at: now };
  memory.set(day, entry);
  if (memory.size > 16) memory.delete(memory.keys().next().value!);
  try {
    await runtime()?.set(day, entry, { ttl: 86400, name: "ROMNOA Yahoo topics of a day" });
  } catch {
    /* memory copy remains */
  }
  return articles;
}

export function parseYahooTopics(xml: string) {
  if (
    Buffer.byteLength(xml) > 200000 ||
    /<!\s*(DOCTYPE|ENTITY)/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw Error("invalid_feed");
  const root = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
  }).parse(xml);
  const raw = root?.rss?.channel?.item;
  const rows = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const articles = rows
    .slice(0, 30)
    .flatMap((item: Record<string, unknown>) => {
      const comments = typeof item.comments === "string" ? item.comments : "";
      const id = comments.match(
        /^https:\/\/news\.yahoo\.co\.jp\/articles\/([a-f0-9]{40})\/comments$/,
      )?.[1];
      const url =
        id && yahooArticleUrl(`https://news.yahoo.co.jp/articles/${id}`);
      const title =
        typeof item.title === "string" ? item.title.trim().slice(0, 500) : "";
      const date =
        typeof item.pubDate === "string" ? Date.parse(item.pubDate) : NaN;
      if (!url || !title) return [];
      return [
        yahooArticleSchema.parse({
          id: url,
          url,
          title,
          summary: "",
          image: null,
          category: "domestic",
          origin: "topic",
          publishedAt: Number.isFinite(date)
            ? new Date(date).toISOString()
            : null,
        }),
      ];
    });
  if (!articles.length) throw Error("empty_topics");
  return [...new Map(articles.map((a) => [a.id, a])).values()];
}
export async function handleYahooTopics(
  request: Request,
  fetcher: typeof fetch = fetch,
  enabled = true,
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers },
    );
  if (!enabled)
    return Response.json(
      { error: "この機能は現在利用できません。" },
      { status: 403, headers },
    );
  const params = new URL(request.url).searchParams;
  const day = params.get("date");
  if (
    [...params.keys()].some((k) => k !== "date") ||
    params.getAll("date").length > 1 ||
    (day !== null && !validTopicDay(day))
  )
    return Response.json(
      { error: "日付が正しくありません。" },
      { status: 400, headers },
    );
  if (day !== null) {
    try {
      return Response.json(
        { date: day, articles: await cachedTopicsForDay(day, fetcher) },
        { headers },
      );
    } catch {
      if (day !== japanDay())
        return Response.json(
          { error: "この日のトピックスを取得できませんでした。" },
          { status: 503, headers },
        );
      // Today can still be served from the current topics feed below.
    }
  }
  try {
    const response = await fetcher(
      "https://news.yahoo.co.jp/rss/topics/top-picks.xml",
      { redirect: "error", signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok || Number(response.headers.get("content-length")) > 200000)
      throw Error("unavailable");
    if (!response.body) throw Error("unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 200000) throw Error("too_large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const xml = Buffer.concat(chunks).toString("utf8");
    return Response.json(
      { ...(day ? { date: day, partial: true } : {}), articles: parseYahooTopics(xml) },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "トピックスを取得できませんでした。" },
      { status: 503, headers },
    );
  }
}
