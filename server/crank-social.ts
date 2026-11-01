import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode } from "domhandler";
import { socialPostUrl } from "../src/lib/reader-media.js";

// These publisher pages are embeds of posts, rather than photo galleries.
// Only inspect the article's dedicated embed container, never recommendations.
export function crankSocial(html: string, pageUrl: string) {
  const url = new URL(pageUrl);
  if (!/^(?:www|m)\.crank-in\.net$/.test(url.hostname) || !/^\/sns\/news\/\d+\/\d+\/?$/.test(url.pathname) || url.search || url.hash) return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const hasClass = (s: string, name: string) => s.split(/\s+/).includes(name);
  const main = DomUtils.findOne((n) => n.name === "main" && hasClass(n.attribs.class || "", "main-body"), doc.children);
  const article = main && DomUtils.findOne((n) => n.name === "article" && !!DomUtils.findOne((h) => h.name === "h1" && hasClass(h.attribs.class || "", "headline"), n.children), main.children);
  const container = article && DomUtils.findOne((n) => n.name === "div" && hasClass(n.attribs.class || "", "center-img-box"), article.children);
  if (!container) return null;
  const embeds = DomUtils.findAll((n) => n.name === "blockquote" && (hasClass(n.attribs.class || "", "twitter-tweet") || hasClass(n.attribs.class || "", "instagram-media")), container.children);
  const posts = embeds.flatMap((node) => {
    let ancestor: AnyNode | null = node;
    while (ancestor && ancestor !== container) {
      if ("attribs" in ancestor && (ancestor.attribs["aria-hidden"] === "true" || ancestor.attribs.hidden !== undefined || /(?:recommend|related|ranking|advert|(?:^|[-_\s])ads?(?:$|[-_\s]))/i.test(`${ancestor.attribs.id || ""} ${ancestor.attribs.class || ""}`))) return [];
      ancestor = ancestor.parent;
    }
    const source = hasClass(node.attribs.class || "", "twitter-tweet")
      ? DomUtils.findAll((n) => n.name === "a", node.children).map((a) => a.attribs.href || "")
      : hasClass(node.attribs.class || "", "instagram-media") && node.attribs["data-instgrm-permalink"] ? [node.attribs["data-instgrm-permalink"]] : [];
    const parsed = source.map(socialPostUrl).filter((post): post is NonNullable<ReturnType<typeof socialPostUrl>> => !!post);
    return parsed.length ? [parsed[parsed.length - 1]] : [];
  }).filter((post, i, all) => all.findIndex((other) => other.url === post.url) === i).slice(0, 12);
  if (!posts.length) {
    if (embeds.length) throw Error("social_post_unavailable");
    return null;
  }
  const title = DomUtils.findOne((n) => n.name === "title", doc.children);
  return { kind: "social" as const, posts, title: title ? DomUtils.textContent(title).trim().slice(0, 500) : "" };
}
