// Yahoo! News comments shown inside the app without the comment page's ads,
// rankings and recommendation widgets. Only the server-rendered comment list
// of the requested article is read; replies, votes and posting stay on Yahoo.
import { Parser } from "htmlparser2";
import { yahooArticleUrl } from "../src/lib/yahoo-model.js";
import {
  yahooCommentsSchema,
  type YahooCommentOrder,
  type YahooComments,
} from "../src/lib/yahoo-comments-model.js";
import { fetchPublicPhoto } from "./public-photo-fetch.js";

const MAX_BYTES = 3_000_000;
const PER_PAGE = 10;
export const MAX_COMMENT_PAGE = 50;

const object = (s: unknown): Record<string, unknown> =>
  s && typeof s === "object" && !Array.isArray(s)
    ? (s as Record<string, unknown>)
    : {};
const array = (s: unknown) => (Array.isArray(s) ? s : []);
const count = (s: unknown) =>
  typeof s === "number" && Number.isInteger(s) && s >= 0 ? s : 0;
function line(s: unknown, limit: number) {
  return typeof s === "string"
    ? s
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}
function body(s: unknown) {
  return typeof s === "string"
    ? s
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 3000)
    : "";
}

function preloadedState(html: string) {
  if (Buffer.byteLength(html) > MAX_BYTES) throw Error("page_too_large");
  const states: unknown[] = [];
  let script = "",
    active = false;
  new Parser(
    {
      onopentag(name) {
        if (name === "script") {
          active = true;
          script = "";
        }
      },
      ontext(text) {
        if (active) script += text;
      },
      onclosetag(name) {
        if (name !== "script" || !active) return;
        active = false;
        const m = script.match(
          /^\s*window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
        );
        if (m)
          try {
            states.push(JSON.parse(m[1]));
          } catch {
            /* checked below */
          }
      },
    },
    { decodeEntities: false },
  ).end(html);
  if (states.length !== 1) throw Error("comment_structure_changed");
  return object(states[0]);
}

export function parseYahooComments(
  html: string,
  article: string,
  page: number,
  order: YahooCommentOrder,
): YahooComments {
  if (yahooArticleUrl(article) !== article) throw Error("invalid_article");
  const state = preloadedState(html);
  const info = object(state.commentArticle),
    full = object(state.commentFull),
    id = article.split("/").pop();
  if (info.commentArticleId !== id || info.newsLink !== article)
    throw Error("article_mismatch");
  if (full.commentGetStatus !== "success") throw Error("comments_unavailable");
  const total = count(full.parentOnlyCommentTotalCount);
  const comments: YahooComments["comments"] = [];
  for (const raw of array(full.userCommentList).slice(0, PER_PAGE * 2)) {
    const c = object(raw);
    // Hidden, blocked and deleted comments are not shown on Yahoo either.
    if (
      c.commentArticleId !== id ||
      c.isVisible === false ||
      c.isBlocked === true ||
      (c.userHiddenStatus && c.userHiddenStatus !== "idle") ||
      typeof c.commentId !== "string"
    )
      continue;
    const text = body(c.text);
    if (!text) continue;
    comments.push({
      id: line(c.commentId, 80),
      kind: "user",
      name: line(c.name, 80) || "匿名",
      text,
      postedAt: line(c.postDate, 40),
      empathy: count(c.empathyCount),
      insight: count(c.insightCount),
      negative: count(c.negativeCount),
      replies: count(object(c.reply).totalResults),
    });
  }
  // Expert ("オーサー") comments are shown with the first page only.
  const experts: YahooComments["comments"] = [];
  if (page === 1)
    for (const raw of array(full.commentatorComment).slice(0, 5)) {
      const c = object(raw);
      const text = body(c.text);
      if (c.commentArticleId !== id || !text || typeof c.commentId !== "string")
        continue;
      experts.push({
        id: line(c.commentId, 80),
        kind: "expert",
        name: line(c.name, 80) || "専門家",
        title: line(object(c.commentator).title, 120) || undefined,
        text,
        postedAt: line(c.postDate, 40),
        empathy: count(c.thumbsUpCount),
        insight: 0,
        negative: 0,
        replies: 0,
      });
    }
  const pages = Math.min(
    MAX_COMMENT_PAGE,
    Math.max(1, Math.ceil(total / PER_PAGE)),
  );
  return yahooCommentsSchema.parse({
    article,
    order,
    page,
    pages,
    total,
    totalWithReplies: Math.max(total, count(info.parentAndReplyCommentTotalCount)),
    comments: [...experts, ...comments],
  });
}

export async function fetchYahooComments(
  article: string,
  page: number,
  order: YahooCommentOrder,
): Promise<YahooComments> {
  if (
    yahooArticleUrl(article) !== article ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > MAX_COMMENT_PAGE
  )
    throw Error("invalid_article");
  const params = new URLSearchParams();
  if (order === "newer") params.set("order", "newer");
  if (page > 1) params.set("page", String(page));
  const query = params.size ? `?${params}` : "";
  const res = await fetchPublicPhoto(`${article}/comments${query}`, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: "text/html",
      "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
    },
  });
  // Articles whose comment section is closed answer 404.
  if (res.status === 404) {
    await res.body?.cancel();
    return yahooCommentsSchema.parse({
      article,
      order,
      page: 1,
      pages: 1,
      total: 0,
      totalWithReplies: 0,
      closed: true,
      comments: [],
    });
  }
  if (
    !res.ok ||
    !res.body ||
    !/text\/html/i.test(res.headers.get("content-type") || "")
  ) {
    await res.body?.cancel();
    throw Error("source_unavailable");
  }
  if (Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body.cancel();
    throw Error("page_too_large");
  }
  const reader = res.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) throw Error("page_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return parseYahooComments(
    Buffer.concat(chunks).toString("utf8"),
    article,
    page,
    order,
  );
}

// Comments change quickly; a short shared cache only absorbs repeated opens.
const cache = new Map<string, { at: number; value: YahooComments }>();
export async function getYahooComments(
  article: string,
  page: number,
  order: YahooCommentOrder,
  load = fetchYahooComments,
  now = Date.now,
) {
  const key = `${order}:${page}:${article}`,
    hit = cache.get(key);
  if (hit && now() - hit.at >= 0 && now() - hit.at < 120_000) return hit.value;
  const value = await load(article, page, order);
  cache.delete(key);
  cache.set(key, { at: now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}

export async function handleYahooComments(
  request: Request,
  load: typeof getYahooComments = getYahooComments,
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const params = new URL(request.url).searchParams,
    article = params.get("article") || "",
    rawPage = params.get("page") || "1",
    order = params.get("order") || "recommended",
    page = Number(rawPage);
  if (
    yahooArticleUrl(article) !== article ||
    !/^[1-9]\d{0,2}$/.test(rawPage) ||
    page > MAX_COMMENT_PAGE ||
    (order !== "recommended" && order !== "newer") ||
    [...params.keys()].some(
      (k) =>
        !["article", "page", "order"].includes(k) ||
        params.getAll(k).length !== 1,
    )
  )
    return Response.json(
      { error: "指定できないパラメータです。" },
      { status: 400, headers },
    );
  try {
    return Response.json(await load(article, page, order), { headers });
  } catch {
    return Response.json(
      { error: "コメントを取得できませんでした。" },
      { status: 502, headers },
    );
  }
}
