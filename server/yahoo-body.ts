import { Parser } from "htmlparser2";
import { yahooArticleUrl, yahooImageUrl } from "../src/lib/yahoo-model.js";
import { fetchPublicPhoto } from "./public-photo-fetch.js";
import { classifyPhotoLink } from "../src/lib/photo-link-classifier.js";
import { socialPostUrl } from "../src/lib/reader-media.js";

export function parseYahooBody(html: string, article: string, page: number) {
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  let script = "",
    active = false,
    state: any,
    matches = 0;
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
        if (m) {
          matches++;
          try {
            state = JSON.parse(m[1]);
          } catch {
            /* invalid */
          }
        }
      },
    },
    { decodeEntities: false },
  ).end(html);
  const detail = state?.articleDetail;
  if (
    matches !== 1 ||
    detail?.contentId !== article.split("/").pop() ||
    detail.newsLink !== article ||
    Number(detail.currentPage ?? 1) !== page
  )
    throw Error("article_mismatch");
  const paragraphs = Array.isArray(detail.paragraphs) ? detail.paragraphs : [];
  const text = paragraphs
    .map((p: any) => p?.textDetails?.[0]?.text)
    .filter((t: unknown): t is string => typeof t === "string")
    .join("\n\n")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  const total = Number(detail.maxPage ?? 1);
  if (
    !text ||
    text.length > 100_000 ||
    !Number.isInteger(total) ||
    total < page ||
    total > 100
  )
    throw Error("body_unavailable");
  type Part = {
    kind: "text" | "link" | "image" | "photo" | "social";
    text: string;
    url?: string;
  };
  const rich: Part[] = [];
  let nodes = 0;
  const items = Array.isArray(detail.richObjectItems)
    ? detail.richObjectItems
    : [];
  function visit(node: any, depth = 0) {
    if (!node || ++nodes > 20000 || depth > 80 || rich.length >= 4000) return;
    if (node.type === "text" && typeof node.value === "string") {
      rich.push({ kind: "text", text: node.value.slice(0, 10000) });
      return;
    }
    const tag = node.tagName,
      children = Array.isArray(node.children) ? node.children : [];
    if (tag === "yjrf-img") {
      const image = items.find(
        (item: any) =>
          String(item.objectId) === String(node.attributes?.["data-obj-id"]),
      );
      const url = yahooImageUrl(
        image?.view?.uri ||
          image?.resizedViewUrl?.jpeg ||
          image?.thumb?.uri ||
          "",
      );
      if (url)
        rich.push({
          kind: "image",
          url,
          text: String(image?.caption || image?.alt || "").slice(0, 500),
        });
      return;
    }
    if (tag === "a") {
      const href = node.attributes?.href;
      const label = children
        .map((c: any) => (c?.type === "text" ? c.value || "" : ""))
        .join("");
      try {
        const u = new URL(href);
        if (
          label &&
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          href.length <= 2048
        ) {
          // Shops, apps, tickets, Yahoo's own duplicates and "related"/PR
          // links are dropped with their label. SNS posts and photo pages are
          // shown inside the app; only other story links stay external.
          const post = socialPostUrl(u.href);
          if (post) {
            rich.push({
              kind: "social",
              url: post.url,
              text: label.slice(0, 2000),
            });
            return;
          }
          const link = classifyPhotoLink(u.href, label);
          if (link.kind === "gallery" || link.kind === "photo")
            rich.push({
              kind: "photo",
              url: u.href,
              text: label.slice(0, 2000),
            });
          else if (link.kind === "article" && link.score >= 0)
            rich.push({
              kind: "link",
              url: u.href,
              text: label.slice(0, 2000),
            });
          return;
        }
      } catch {
        /* traverse children */
      }
    }
    if (tag === "br") {
      rich.push({ kind: "text", text: "\n" });
      return;
    }
    for (const child of children) visit(child, depth + 1);
    if (["p", "h2", "h3", "figcaption"].includes(tag))
      rich.push({ kind: "text", text: "\n\n" });
  }
  if (Array.isArray(detail.richBody))
    for (const node of detail.richBody) visit(node);
  return { text, total, rich };
}
export async function fetchYahooBodyPage(article: string, page: number) {
  if (
    yahooArticleUrl(article) !== article ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10
  )
    throw Error("invalid_article");
  const res = await fetchPublicPhoto(
    page === 1 ? article : `${article}?page=${page}`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "text/html",
        "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
      },
    },
  );
  if (
    !res.ok ||
    !res.body ||
    !/text\/html/i.test(res.headers.get("content-type") || "")
  ) {
    await res.body?.cancel();
    throw Error("source_unavailable");
  }
  const reader = res.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_000_000) throw Error("page_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return parseYahooBody(Buffer.concat(chunks).toString("utf8"), article, page);
}
export async function getYahooBody(article: string, load = fetchYahooBodyPage) {
  const first = await load(article, 1);
  const count = Math.min(first.total, 10);
  const rest = await Promise.allSettled(
    Array.from({ length: count - 1 }, (_, i) => load(article, i + 2)),
  );
  const pages = [first.text];
  const richPages = [first.rich || []];
  for (const result of rest) {
    if (result.status !== "fulfilled" || result.value.total !== first.total)
      break;
    pages.push(result.value.text);
    richPages.push(result.value.rich || []);
  }
  return { article, pages, richPages, complete: pages.length === first.total };
}
export async function handleYahooBody(
  request: Request,
  load = getYahooBody,
  preview = !process.env.VERCEL || process.env.VERCEL_ENV === "preview",
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers },
    );
  const params = new URL(request.url).searchParams,
    article = params.get("article") || "";
  if (
    yahooArticleUrl(article) !== article ||
    [...params.keys()].some(
      (k) => k !== "article" || params.getAll(k).length !== 1,
    )
  )
    return Response.json(
      { error: "記事URLが不正です。" },
      { status: 400, headers },
    );
  if (!preview)
    return Response.json(
      { error: "個人用プレビュー専用です。" },
      { status: 403, headers },
    );
  try {
    return Response.json(await load(article), { headers });
  } catch {
    return Response.json(
      { error: "本文を取得できませんでした。" },
      { status: 502, headers },
    );
  }
}
