import { parseDocument, DomUtils } from "htmlparser2";
import { getCache } from "@vercel/functions";
import {
  readerDocumentSchema,
  readerImageUrl,
  type ReaderDocument,
} from "../src/lib/reader-model.js";
import type { Article } from "../src/lib/model.js";
import { feedService, type FeedService } from "./feed-service.js";

type Node = ReturnType<typeof parseDocument>["children"][number];
type Block = ReaderDocument["blocks"][number];
const MAX_HTML = 2_000_000;
const MAX_TEXT = 100_000;
const MAX_AGE = 86_400_000;
const NON_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "video",
  "audio",
  "object",
  "embed",
  "noscript",
  "form",
  "nav",
  "footer",
  "header",
  "aside",
  "template",
  "button",
  "input",
  "select",
]);
const BLOCK_TAGS = new Set([
  "div",
  "p",
  "blockquote",
  "li",
  "section",
  "article",
  "h1",
  "h2",
  "h3",
  "h4",
  "pre",
  "dt",
  "dd",
  "tr",
]);

export class ReaderError extends Error {
  constructor(
    public code: "not_found" | "unavailable" | "empty",
    message: string,
  ) {
    super(message);
  }
}

export function articleTarget(
  url: string,
): { sourceId: Article["sourceId"]; url: string } | null {
  try {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return null;
    if (
      u.hostname === "hamusoku.com" &&
      /^\/archives\/[1-9]\d{5,11}\.html$/.test(u.pathname)
    )
      return { sourceId: "hamusoku", url: u.href };
    if (
      u.hostname === "alfalfalfa.com" &&
      /^\/articles\/[1-9]\d{5,11}\.html$/.test(u.pathname)
    )
      return { sourceId: "alfalfa", url: u.href };
    return null;
  } catch {
    return null;
  }
}

export function extractArticle(
  html: string,
  article: Article,
  now = Date.now(),
): ReaderDocument {
  if (Buffer.byteLength(html) > MAX_HTML)
    throw new ReaderError(
      "unavailable",
      "記事が大きすぎるため表示できません。",
    );
  const doc = parseDocument(html, { decodeEntities: true });
  const classes =
    article.sourceId === "hamusoku"
      ? ["article-body-inner", "article-body-more"]
      : ["article_body", "article_bodymore"];
  // Fixed source-specific body roots. Never fall back to rendering the whole page.
  const roots = DomUtils.findAll(
    (el) =>
      (el.attribs.class || "").split(/\s+/).some((c) => classes.includes(c)),
    doc.children,
  );
  const selected = roots.filter((el) => {
    let parent = el.parent;
    while (parent) {
      if (roots.some((root) => root === parent)) return false;
      parent = parent.parent;
    }
    return true;
  });
  const blocks: Block[] = [];
  const images = new Set<string>();
  let text = "",
    length = 0;
  const flush = () => {
    const clean = text
      .replace(/[\t\r ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    text = "";
    if (!clean) return;
    if (length + clean.length > MAX_TEXT || blocks.length >= 599)
      throw new ReaderError(
        "unavailable",
        "記事が長すぎるため表示できません。",
      );
    length += clean.length;
    for (let i = 0; i < clean.length; i += 12000)
      blocks.push({ type: "text", text: clean.slice(i, i + 12000) });
  };
  const walk = (node: Node, depth = 0) => {
    if (depth > 120)
      throw new ReaderError(
        "unavailable",
        "記事の構造を読み取れませんでした。",
      );
    if (node.type === "text") {
      text += node.data;
      return;
    }
    if (node.type !== "tag") return;
    const a = node.attribs;
    const tokens = `${a.class || ""} ${a.id || ""}`;
    if (
      NON_CONTENT.has(node.name) ||
      a.hidden !== undefined ||
      a["aria-hidden"] === "true" ||
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style || "") ||
      /(?:^|[-_\s])(?:ad|ads|advert|advertisement)(?:$|[-_\s])|adsbygoogle|google-auto-placed|related|recommend|pickup|kaerebalink|rakuten|amazon|blogroll|antenna/i.test(
        tokens,
      ) ||
      Object.keys(a).some((k) => k.startsWith("data-ad-"))
    )
      return;
    if (node.name === "br") {
      text += "\n";
      return;
    }
    if (node.name === "img") {
      if (
        (a.width && Number(a.width) <= 4) ||
        (a.height && Number(a.height) <= 4)
      )
        return;
      const image = readerImageUrl(
        a["data-src"] || a.src || "",
        article.sourceId,
      );
      if (image && !images.has(image) && images.size < 24) {
        flush();
        images.add(image);
        blocks.push({
          type: "image",
          url: image,
          alt: (a.alt || "記事内の画像").slice(0, 160),
        });
      }
      return;
    }
    if (BLOCK_TAGS.has(node.name)) flush();
    node.children.forEach((child) => walk(child, depth + 1));
    if (BLOCK_TAGS.has(node.name)) flush();
  };
  selected.forEach((root) => walk(root));
  flush();
  if (!blocks.length || (!length && !images.size))
    throw new ReaderError("empty", "このページの本文を読み取れませんでした。");
  return readerDocumentSchema.parse({
    articleId: article.id,
    sourceId: article.sourceId,
    title: article.title,
    url: article.url,
    fetchedAt: new Date(now).toISOString(),
    blocks,
  });
}

export async function fetchArticle(
  article: Article,
  fetcher: typeof fetch = fetch,
): Promise<ReaderDocument> {
  const target = articleTarget(article.url);
  if (
    !target ||
    target.sourceId !== article.sourceId ||
    article.id !== target.url
  )
    throw new ReaderError("not_found", "対応していない記事です。");
  const response = await fetcher(target.url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      Accept: "text/html, application/xhtml+xml",
      "User-Agent":
        "ROMNOA/0.2 personal-reader (+https://github.com/syoudai0514/ROMNOA)",
    },
  });
  if (
    !response.ok ||
    !response.body ||
    !/text\/html|application\/xhtml\+xml/i.test(
      response.headers.get("content-type") || "",
    )
  ) {
    await response.body?.cancel();
    throw new ReaderError(
      "unavailable",
      "配信元から本文を取得できませんでした。",
    );
  }
  if (Number(response.headers.get("content-length")) > MAX_HTML) {
    await response.body.cancel();
    throw new ReaderError(
      "unavailable",
      "記事が大きすぎるため表示できません。",
    );
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_HTML)
        throw new ReaderError(
          "unavailable",
          "記事が大きすぎるため表示できません。",
        );
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return extractArticle(Buffer.concat(parts).toString("utf8"), article);
}

export type ReaderEntry = {
  checkedAt: number;
  document: ReaderDocument | null;
};
export interface ReaderCache {
  get(key: string): Promise<ReaderEntry | undefined>;
  set(key: string, value: ReaderEntry): Promise<void>;
}
export class MemoryReaderCache implements ReaderCache {
  private data = new Map<string, ReaderEntry>();
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: ReaderEntry) {
    this.data.set(key, value);
  }
}
function runtimeCache(): ReaderCache {
  if (!process.env.VERCEL) return new MemoryReaderCache();
  const cache = getCache({ namespace: "romnoa-personal-reader-v1" });
  return {
    async get(key) {
      const value = (await cache.get(key)) as ReaderEntry | undefined;
      if (!value || typeof value.checkedAt !== "number") return undefined;
      if (value.document === null) return value;
      const parsed = readerDocumentSchema.safeParse(value.document);
      return parsed.success
        ? { checkedAt: value.checkedAt, document: parsed.data }
        : undefined;
    },
    async set(key, value) {
      await cache.set(key, value, {
        ttl: 86400,
        name: "ROMNOA personal reader",
      });
    },
  };
}
export class ReaderService {
  private pending = new Map<string, Promise<ReaderDocument>>();
  constructor(
    private cache: ReaderCache,
    private feeds: Pick<FeedService, "get"> = feedService,
    private load = fetchArticle,
    private now = Date.now,
  ) {}
  async get(id: string): Promise<ReaderDocument> {
    if (!articleTarget(id))
      throw new ReaderError("not_found", "対応していない記事です。");
    const pending = this.pending.get(id);
    if (pending) return pending;
    const work = this.read(id);
    this.pending.set(id, work);
    try {
      return await work;
    } finally {
      this.pending.delete(id);
    }
  }
  private async read(id: string): Promise<ReaderDocument> {
    let old: ReaderEntry | undefined;
    try {
      old = await this.cache.get(id);
    } catch {
      console.error("ROMNOA reader_cache_read_failed");
    }
    const now = this.now();
    if (
      old?.document &&
      old.document.articleId === id &&
      now - Date.parse(old.document.fetchedAt) >= -60_000 &&
      now - Date.parse(old.document.fetchedAt) < MAX_AGE
    )
      return old.document;
    if (old && !old.document && now - old.checkedAt < 60_000)
      throw new ReaderError(
        "unavailable",
        "本文を取得できませんでした。時間をおいて再試行してください。",
      );
    const feed = await this.feeds.get();
    const article = feed.articles.find((a) => a.id === id);
    if (!article)
      throw new ReaderError(
        "not_found",
        "現在の配信フィードにない記事です。端末に保存した本文があればそちらを利用できます。",
      );
    try {
      const document = await this.load(article);
      try {
        await this.cache.set(id, { checkedAt: now, document });
      } catch {
        console.error("ROMNOA reader_cache_write_failed");
      }
      return document;
    } catch (error) {
      console.error(
        "ROMNOA reader_fetch_failed",
        article.sourceId,
        error instanceof Error ? error.name : "unknown",
      );
      try {
        await this.cache.set(id, { checkedAt: now, document: null });
      } catch {
        /* best effort */
      }
      throw error instanceof ReaderError
        ? error
        : new ReaderError(
            "unavailable",
            "本文を取得できませんでした。再試行してください。",
          );
    }
  }
}
export const readerService = new ReaderService(runtimeCache());

export async function handleReader(
  request: Request,
  service: Pick<ReaderService, "get"> = readerService,
  preview = !process.env.VERCEL || process.env.VERCEL_ENV === "preview",
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  // Owner-protected Preview only. Public/production deployment needs a separate rights review.
  if (!preview)
    return Response.json(
      { error: "個人用プレビュー専用のリーダーです。", code: "private_only" },
      { status: 403, headers },
    );
  if (request.method !== "GET")
    return Response.json(
      { error: "GETのみ利用できます。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const params = new URL(request.url).searchParams;
  const id = params.get("article") || "";
  if ([...params.keys()].length !== 1 || id.length > 2048 || !articleTarget(id))
    return Response.json(
      { error: "記事IDが正しくありません。", code: "not_found" },
      { status: 400, headers },
    );
  try {
    return Response.json(await service.get(id), { headers });
  } catch (error) {
    const problem =
      error instanceof ReaderError
        ? error
        : new ReaderError("unavailable", "本文を取得できませんでした。");
    return Response.json(
      { error: problem.message, code: problem.code },
      { status: problem.code === "not_found" ? 404 : 503, headers },
    );
  }
}
