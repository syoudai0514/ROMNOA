import { parseDocument, DomUtils } from "htmlparser2";
import { getCache } from "@vercel/functions";
import {
  readerArticleTarget,
  readerDocumentSchema,
  readerImageUrl,
  readerImageFromLink,
  readerLinkUrl,
  type ReaderDocument,
} from "../src/lib/reader-model.js";
import { classify, type Article } from "../src/lib/model.js";
import { feedService, type FeedService } from "./feed-service.js";

type Node = ReturnType<typeof parseDocument>["children"][number];
type Tag = Extract<Node, { attribs: Record<string, string> }>;
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

export const articleTarget = readerArticleTarget;

// Normalize only tracking decoration on direct links, never redirect/proxy targets.
export function linkedArticle(
  raw: string,
  base: string,
): ReturnType<typeof articleTarget> {
  try {
    const u = new URL(raw, base);
    if (u.protocol === "http:") u.protocol = "https:";
    if (
      [...u.searchParams.keys()].some(
        (key) => !/^utm_[a-z_]+$|^(?:from|area|type|pos)$/i.test(key),
      )
    )
      return null;
    u.search = "";
    u.hash = "";
    return articleTarget(u.href);
  } catch {
    return null;
  }
}

function hidden(node: Tag) {
  const a = node.attribs;
  return (
    a.hidden !== undefined ||
    a["aria-hidden"] === "true" ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style || "")
  );
}
const AD_MARKERS =
  /(?:^|[-_\s])(?:ad|ads|advert|advertisement|sponsored|affiliate|banner)(?:$|[-_\s])|adsbygoogle|google-auto-placed|kaerebalink|rakuten|amazon|blogroll|antenna/i;
function advertisement(node: Tag) {
  const a = node.attribs;
  return (
    AD_MARKERS.test(`${a.class || ""} ${a.id || ""}`) ||
    Object.keys(a).some((key) => key.startsWith("data-ad-")) ||
    /(?:^|\s)sponsored(?:$|\s)/i.test(a.rel || "") ||
    (node.name === "a" &&
      /(?:amazon\.|amzn\.|link\.amazon|rakuten\.|a8\.net|doubleclick\.|googlesyndication\.)/i.test(
        a.href || "",
      ))
  );
}
function recommendation(node: Tag) {
  return /related|recommend|pickup|recent-article-image/i.test(
    `${node.attribs.class || ""} ${node.attribs.id || ""}`,
  );
}
function imageSource(node: Tag) {
  const a = node.attribs;
  return (
    a["data-original"] || a["data-src"] || a["data-lazy-src"] || a.src || ""
  );
}
function thumbnailUrl(raw: string, sourceId: string) {
  // Unwrap the publisher's resize URL, but only ever return the approved image CDN.
  try {
    const u = new URL(raw);
    if (
      u.protocol === "https:" &&
      u.hostname === "resize.blogsys.jp" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search
    ) {
      const start = u.pathname.indexOf("/https://livedoor.blogimg.jp/");
      if (start >= 0) raw = u.pathname.slice(start + 1);
    }
  } catch {
    return null;
  }
  return readerImageUrl(raw, sourceId);
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
  const imageAudit = { excluded: 0, uncertain: 0, related: 0 };
  const pageKind = /【pickup\d*】|\[pickup\d*\]/i.test(article.title)
    ? "roundup"
    : "article";
  const links = new Map<string, { url: string; title: string }>();
  const related = new Map<string, ReaderDocument["related"][number]>();
  const collectRelated = (node: Node, depth = 0) => {
    if (
      depth > 120 ||
      node.type !== "tag" ||
      hidden(node) ||
      advertisement(node) ||
      ["script", "style", "iframe", "noscript", "template", "form"].includes(
        node.name,
      )
    )
      return;
    if (node.name === "a") {
      const target = linkedArticle(node.attribs.href || "", article.url);
      if (target && target.url !== article.id) {
        const text = DomUtils.textContent(node).replace(/\s+/g, " ").trim();
        const rawTitle =
          text ||
          node.attribs.title ||
          DomUtils.findAll((el) => el.name === "img", node.children)[0]?.attribs
            .alt ||
          "";
        const title =
          /^(?:続きを読む|読み続きを読む|こちら|詳細|記事へ|もっと見る)$/.test(
            rawTitle,
          )
            ? ""
            : rawTitle;
        const thumbnail =
          DomUtils.findAll((el) => el.name === "img", node.children)
            .filter(
              (el) =>
                !hidden(el) &&
                !advertisement(el) &&
                !(
                  parseFloat(el.attribs.width) <= 4 ||
                  parseFloat(el.attribs.height) <= 4
                ) &&
                (() => {
                  let parent = el.parent;
                  while (parent && parent !== node) {
                    if (
                      parent.type === "tag" &&
                      (hidden(parent) || advertisement(parent))
                    )
                      return false;
                    parent = parent.parent;
                  }
                  return true;
                })(),
            )
            .map((el) => thumbnailUrl(imageSource(el), target.sourceId))
            .find(Boolean) || null;
        const old = related.get(target.url);
        if (old || related.size < 40)
          related.set(target.url, {
            article: {
              id: target.url,
              url: target.url,
              sourceId: target.sourceId,
              title: (title || old?.article.title || "").slice(0, 300),
              category: classify(title || old?.article.title || ""),
              publishedAt: null,
            },
            thumbnail: thumbnail || old?.thumbnail || null,
          });
      }
    }
    node.children.forEach((child) => collectRelated(child, depth + 1));
  };
  // Pickup pages contain repeated headline/cover/read-more groups. Prioritize
  // direct article headlines before random text links so the actual story is reachable.
  const headlines = selected.flatMap((root) =>
    DomUtils.findAll(
      (el) =>
        (el.attribs.class || "").split(/\s+/).includes("daily_popular_title"),
      root.children,
    ),
  );
  for (const headline of headlines) {
    let parent = headline.parent;
    let safe = true;
    while (parent) {
      if (
        parent.type === "tag" &&
        (hidden(parent) ||
          advertisement(parent) ||
          ["script", "noscript", "template"].includes(parent.name))
      )
        safe = false;
      parent = parent.parent;
    }
    if (safe) collectRelated(headline);
  }
  // Explicit editorial areas only. No execution of third-party recommendation scripts.
  selected.forEach((root) => collectRelated(root));
  const editorial = DomUtils.findAll((el) => recommendation(el), doc.children);
  for (const root of editorial) {
    let parent = root.parent;
    let safe = true;
    while (parent) {
      if (
        parent.type === "tag" &&
        (hidden(parent) ||
          advertisement(parent) ||
          ["script", "noscript", "template"].includes(parent.name))
      )
        safe = false;
      parent = parent.parent;
    }
    if (safe) collectRelated(root);
  }
  const countImages = (node: Node) =>
    node.type === "tag"
      ? node.name === "img"
        ? 1
        : DomUtils.findAll((el) => el.name === "img", node.children).length
      : 0;
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
  const addImage = (url: string, alt = "記事内の画像", cover = false) => {
    if (images.has(url) || images.size >= 80) return;
    flush();
    images.add(url);
    blocks.push({
      type: "image",
      url,
      alt: alt.slice(0, 160),
      ...(cover ? { role: "cover" as const } : {}),
    });
  };
  const walk = (node: Node, depth = 0) => {
    if (depth > 120)
      throw new ReaderError(
        "unavailable",
        "記事の構造を読み取れませんでした。",
      );
    if (node.type === "text") {
      text += node.data;
      // Some articles publish images as text URLs rather than img elements.
      // Do not promote the label of an unrelated/redirecting anchor.
      let parent = node.parent;
      let anchored = false;
      while (parent) {
        if (parent.type === "tag" && parent.name === "a") anchored = true;
        parent = parent.parent;
      }
      if (!anchored)
        for (const match of node.data.matchAll(/https?:\/\/[^\s<>"']+/g)) {
          const raw = match[0].replace(/[)\]｝）、，。.,;!?]+$/, "");
          const image = readerImageUrl(raw, article.sourceId);
          if (image) {
            addImage(image);
            if (links.size < 40) links.set(raw, { url: raw, title: raw });
          }
        }
      return;
    }
    if (node.type !== "tag") return;
    const a = node.attribs;
    if (
      NON_CONTENT.has(node.name) ||
      hidden(node) ||
      advertisement(node) ||
      recommendation(node)
    ) {
      const count = countImages(node);
      if (recommendation(node) && !advertisement(node))
        imageAudit.related += count;
      else imageAudit.excluded += count;
      return;
    }
    if (node.name === "a") {
      const direct = linkedArticle(a.href || "", article.url);
      const url = direct?.url || readerLinkUrl(a.href || "", article.url);
      const label =
        DomUtils.textContent(node).replace(/\s+/g, " ").trim() ||
        DomUtils.findAll((el) => el.name === "img", node.children)[0]?.attribs
          .alt ||
        "画像の掲載先";
      // Avoid forwarding antenna/redirect links when the publisher provides a
      // direct article link for that same headline on a Pickup page.
      const indirect = pageKind === "roundup" && !direct;
      if (url && url !== article.url && !indirect && links.size < 40)
        links.set(url, { url, title: label.slice(0, 300) });
      const image = readerImageFromLink(url || "", article.sourceId, [label]);
      if (
        image &&
        !DomUtils.findAll((el) => el.name === "img", node.children).length
      )
        addImage(image);
    }
    if (node.name === "br") {
      text += "\n";
      return;
    }
    if (node.name === "img") {
      if (parseFloat(a.width) <= 4 || parseFloat(a.height) <= 4) {
        imageAudit.excluded++;
        return;
      }
      let image = readerImageUrl(imageSource(node), article.sourceId);
      let parent = node.parent;
      while (parent) {
        if (parent.type === "tag" && parent.name === "a") {
          const raw = parent.attribs.href || "";
          const linked = linkedArticle(raw, article.url);
          if (linked && linked.url !== article.id) {
            imageAudit.related++;
            return;
          }
          const full = readerImageUrl(raw, article.sourceId);
          if (!full && linked?.url !== article.id) {
            imageAudit.uncertain++;
            return;
          }
          if (full && image) image = full;
          break;
        }
        parent = parent.parent;
      }
      if (!image) {
        imageAudit.uncertain++;
        return;
      }
      let context = node.parent;
      let cover = false;
      while (context) {
        if (
          context.type === "tag" &&
          /(?:^|\s)(?:eye-catch|eyecatch|article-cover)(?:\s|$)/i.test(
            context.attribs.class || "",
          )
        )
          cover = true;
        if (selected.some((root) => root === context)) break;
        context = context.parent;
      }
      addImage(image, a.alt || "記事内の画像", cover);
      return;
    }
    if (BLOCK_TAGS.has(node.name)) flush();
    node.children.forEach((child) => walk(child, depth + 1));
    if (BLOCK_TAGS.has(node.name)) flush();
  };
  selected.forEach((root) => walk(root));
  flush();
  if (pageKind === "roundup") imageAudit.related += images.size;
  if (!blocks.length || (!length && !images.size))
    throw new ReaderError("empty", "このページの本文を読み取れませんでした。");
  return readerDocumentSchema.parse({
    schemaVersion: 3,
    pageKind,
    links: [...links.values()],
    articleId: article.id,
    sourceId: article.sourceId,
    title: article.title,
    url: article.url,
    fetchedAt: new Date(now).toISOString(),
    blocks:
      pageKind === "roundup"
        ? [
            {
              type: "text",
              text: "複数の記事を紹介する一覧ページです。タイトルから本編を開けます。",
            },
          ]
        : blocks,
    imageAudit,
    related: [...related.values()]
      .filter((r) => r.article.title.length >= 4)
      .slice(0, 12),
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
  const cache = getCache({ namespace: "romnoa-personal-reader-v3" });
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
  async get(id: string, from?: string): Promise<ReaderDocument> {
    if (!articleTarget(id))
      throw new ReaderError("not_found", "対応していない記事です。");
    const key = `${id}\n${from || ""}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = this.read(id, from);
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
  private async read(id: string, from?: string): Promise<ReaderDocument> {
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
    let article = feed.articles.find((a) => a.id === id);
    if (!article && from && articleTarget(from)) {
      // A client-provided parent is not proof: verify the exact link in a fresh,
      // server-extracted parent document. Do not recursively fetch supplied URLs.
      try {
        const parent = await this.cache.get(from);
        const parsed = readerDocumentSchema.safeParse(parent?.document);
        if (
          parsed.success &&
          parsed.data.articleId === from &&
          now - Date.parse(parsed.data.fetchedAt) >= -60_000 &&
          now - Date.parse(parsed.data.fetchedAt) < MAX_AGE
        )
          article = parsed.data.related.find(
            (r) => r.article.id === id,
          )?.article;
      } catch {
        console.error("ROMNOA reader_parent_cache_failed");
      }
    }
    if (!article)
      throw new ReaderError(
        "not_found",
        "配信フィードにも、確認済みの関連記事にもない記事です。元の記事を開き直してからお試しください。",
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
  const from = params.get("from") || undefined;
  if (
    params.getAll("article").length !== 1 ||
    params.getAll("from").length > 1 ||
    [...params.keys()].some((key) => key !== "article" && key !== "from") ||
    (params.has("from") &&
      (!from || from.length > 2048 || !articleTarget(from) || from === id)) ||
    id.length > 2048 ||
    !articleTarget(id)
  )
    return Response.json(
      { error: "記事IDが正しくありません。", code: "not_found" },
      { status: 400, headers },
    );
  try {
    return Response.json(await service.get(id, from), { headers });
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
