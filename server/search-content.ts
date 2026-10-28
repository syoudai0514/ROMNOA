import { parseDocument, DomUtils } from "htmlparser2";
import { getCache } from "@vercel/functions";
import { z } from "zod";
import type { Article } from "../src/lib/model.js";
import { readerArticleTarget } from "../src/lib/reader-model.js";
import { fetchArticleHtml } from "./article-html.js";

type Node = ReturnType<typeof parseDocument>["children"][number];
type Tag = Extract<Node, { attribs: Record<string, string> }>;
const SKIP_TAGS = new Set([
  "a",
  "script",
  "style",
  "iframe",
  "noscript",
  "template",
  "nav",
  "aside",
  "header",
  "footer",
  "form",
  "button",
  "input",
  "select",
  "video",
  "audio",
  "object",
  "embed",
  "svg",
]);
const SKIP_MARKERS =
  /related|recommend|pickup|blogroll|antenna|recent[-_]article|popular|ranking|rss|(?:^|[-_\s])(?:ad\d*|ads|advert\w*|sponsored|affiliate|banner|social|share)(?:$|[-_\s])|adsbygoogle|kaerebalink|rakuten|amazon/i;
const SECTION_LABEL =
  /^(?:[【\[〈《★☆◆▼\s]*)(?:(?:こちら|あわせて|合わせて)も(?:どうぞ|読みたい)|(?:関連|おすすめ|オススメ|お勧め|人気|新着|注目|過去)記事(?:一覧|まとめ|ランキング)?)(?:[】\]〉》★☆◆▼：:\s]*)$/;
const BOUNDARY = new Set([
  "div",
  "p",
  "br",
  "li",
  "section",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "tr",
]);

// Deliberately independent of the display reader and its historical v3 caches.
// Only publisher body roots, never the page, recommendations, link labels or alt text.
export function extractSearchText(html: string, sourceId: Article["sourceId"]) {
  if (Buffer.byteLength(html) > 2_000_000)
    throw new Error("search_body_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const stack = doc.children.map((node) => ({ node, depth: 0 }));
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++count > 60000 || depth > 120)
      throw new Error("search_body_too_complex");
    if ("children" in node)
      for (const child of node.children)
        stack.push({ node: child, depth: depth + 1 });
  }
  const classes =
    sourceId === "hamusoku"
      ? ["article-body-inner", "article-body-more"]
      : ["article_body", "article_bodymore"];
  const excluded = (el: Tag) =>
    SKIP_TAGS.has(el.name) ||
    el.attribs.hidden !== undefined ||
    el.attribs["aria-hidden"] === "true" ||
    /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
      el.attribs.style || "",
    ) ||
    SKIP_MARKERS.test(`${el.attribs.id || ""} ${el.attribs.class || ""}`) ||
    Object.keys(el.attribs).some((key) => key.startsWith("data-ad-"));
  const roots = DomUtils.findAll(
    (el) =>
      (el.attribs.class || "").split(/\s+/).some((c) => classes.includes(c)),
    doc.children,
  );
  if (!roots.length) throw new Error("search_body_missing");
  let text = "";
  const walk = (node: Node) => {
    if (node.type === "text") {
      text += node.data;
      return;
    }
    if (node.type !== "tag") return;
    if (excluded(node)) {
      text += "\n";
      return;
    }
    if (BOUNDARY.has(node.name)) text += "\n";
    // Classless editorial tail: stop only this container, so a later body-more
    // root still contributes. Labels inside quoted forum responses are preserved.
    let tail = false;
    for (const child of node.children) {
      const label =
        child.type === "tag" &&
        /^(?:div|p|h[1-6]|strong|b|span)$/.test(child.name) &&
        DomUtils.textContent(child).replace(/\s+/g, " ").trim();
      if (label && SECTION_LABEL.test(label)) tail = true;
      if (!tail) walk(child);
      if (text.length > 100000) throw new Error("search_body_too_long");
    }
    if (BOUNDARY.has(node.name)) text += "\n";
  };
  for (const root of roots) {
    let parent = root.parent,
      safe = true;
    while (parent) {
      if (
        roots.includes(parent as Tag) ||
        (parent.type === "tag" && excluded(parent))
      )
        safe = false;
      parent = parent.parent;
    }
    if (safe) walk(root);
  }
  // Preserve boundaries between removed links so keywords cannot join across them.
  return text
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const entrySchema = z.object({
  text: z.string().max(100000).nullable(),
  at: z.number(),
});
type Entry = z.infer<typeof entrySchema>;
export interface SearchTextCache {
  get(key: string): Promise<Entry | undefined>;
  set(key: string, value: Entry): Promise<void>;
}
export class MemorySearchTextCache implements SearchTextCache {
  private values = new Map<string, Entry>();
  async get(key: string) {
    return this.values.get(key);
  }
  async set(key: string, value: Entry) {
    this.values.delete(key);
    this.values.set(key, value);
    if (this.values.size > 300)
      this.values.delete(this.values.keys().next().value!);
  }
}
function runtimeCache(): SearchTextCache {
  if (!process.env.VERCEL) return new MemorySearchTextCache();
  const cache = getCache({ namespace: "romnoa-search-text-v1" });
  return {
    async get(key) {
      const p = entrySchema.safeParse(await cache.get(key));
      return p.success ? p.data : undefined;
    },
    async set(key, value) {
      await cache.set(key, value, {
        ttl: value.text === null ? 60 : 86400,
        name: "ROMNOA clean search text",
      });
    },
  };
}
export class SearchTextService {
  private pending = new Map<string, Promise<string | null>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private async fetchText(article: Article, signal?: AbortSignal) {
    if (this.active >= 6)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      if (signal?.aborted) return null;
      return extractSearchText(
        await this.load(article, signal),
        article.sourceId,
      );
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  constructor(
    private cache: SearchTextCache,
    private load = (article: Article, signal?: AbortSignal) =>
      fetchArticleHtml(article, fetch, signal),
    private now = Date.now,
  ) {}
  async get(article: Article, signal?: AbortSignal): Promise<string | null> {
    if (
      readerArticleTarget(article.id)?.sourceId !== article.sourceId ||
      article.url !== article.id
    )
      return null;
    const pending = this.pending.get(article.id);
    if (pending) return pending;
    const work = (async () => {
      let old: Entry | undefined;
      try {
        old = entrySchema.parse(await this.cache.get(article.id));
      } catch {
        /* cache is optional */
      }
      if (
        old &&
        this.now() - old.at >= -60000 &&
        this.now() - old.at < (old.text === null ? 60000 : 86400000)
      )
        return old.text;
      if (signal?.aborted) return null;
      let text: string | null = null;
      try {
        text = await this.fetchText(article, signal);
      } catch {
        /* unverified is never a positive match */
      }
      try {
        await this.cache.set(article.id, { text, at: this.now() });
      } catch {
        /* best effort */
      }
      return text;
    })();
    this.pending.set(article.id, work);
    try {
      return await work;
    } finally {
      this.pending.delete(article.id);
    }
  }
}
export const searchTextService = new SearchTextService(runtimeCache());
