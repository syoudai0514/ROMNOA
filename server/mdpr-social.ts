import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode } from "domhandler";
import { socialPostUrl } from "../src/lib/reader-media.js";

// Modelpress uses these pages specifically to embed a post related to an article.
// Only trust posts declared in the article's embed container, not recommendations.
export function mdprSocial(html: string, pageUrl: string) {
  const page = new URL(pageUrl);
  if (page.hostname !== "mdpr.jp" || !/^\/photo\/embed\/\d+$/.test(page.pathname) || page.search || page.hash) return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const hasClass = (value: string, name: string) => value.split(/\s+/).includes(name);
  const body = DomUtils.findOne((node) => hasClass(node.attribs.class || "", "pg-photo__body"), doc.children);
  const container = body && DomUtils.findOne((node) => hasClass(node.attribs.class || "", "pg-embed__embed"), body.children);
  if (!container) throw Error("social_post_unavailable");
  const posts = DomUtils.findAll((node) => node.name === "blockquote", container.children).flatMap((node) => {
    let ancestor: AnyNode | null = node;
    while (ancestor && ancestor !== container) {
      if ("attribs" in ancestor && (ancestor.attribs["aria-hidden"] === "true" || ancestor.attribs.hidden !== undefined || /(?:recommend|related|ranking|advert|(?:^|[-_\s])ads?(?:$|[-_\s]))/i.test(`${ancestor.attribs.id || ""} ${ancestor.attribs.class || ""}`))) return [];
      ancestor = ancestor.parent;
    }
    const cls = node.attribs.class || "";
    const candidates = hasClass(cls, "instagram-media") && node.attribs["data-instgrm-permalink"]
      ? [node.attribs["data-instgrm-permalink"]]
      : hasClass(cls, "twitter-tweet")
        ? DomUtils.findAll((child) => child.name === "a", node.children).map((anchor) => anchor.attribs.href || "")
        : [];
    const valid = candidates.map(socialPostUrl).filter((post): post is NonNullable<ReturnType<typeof socialPostUrl>> => !!post);
    return valid.length ? [valid[valid.length - 1]] : [];
  }).filter((post, i, all) => all.findIndex((other) => other.url === post.url) === i).slice(0, 12);
  if (!posts.length) throw Error("social_post_unavailable");
  const title = DomUtils.findOne((node) => node.name === "title", doc.children);
  return { kind: "social" as const, posts, title: title ? DomUtils.textContent(title).trim().slice(0, 500) : "" };
}
