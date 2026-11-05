import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode } from "domhandler";
import { socialPostUrl } from "../src/lib/reader-media.js";

// ENCOUNT's numbered photo pages may contain a social post instead of an
// image gallery. Inspect only the article's dedicated photo/embed region.
export function encountSocial(html: string, pageUrl: string) {
  const url = new URL(pageUrl);
  const page = url.pathname.match(/^\/archives\/\d+\/(\d+)\/$/);
  if (url.hostname !== "encount.press" || !page || Number(page[1]) < 2 || url.search || url.hash) return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const has = (value: string, name: string) => value.split(/\s+/).includes(name);
  const article = DomUtils.findOne(n => n.name === "article" && n.attribs.id === "single", doc.children);
  const content = article && DomUtils.findOne(n => has(n.attribs.class || "", "single__content"), article.children);
  const body = content && DomUtils.findOne(n => has(n.attribs.class || "", "single__content__txt"), content.children);
  if (!body) return null;
  const blocked = (node: AnyNode) => {
    for (let n: AnyNode | null = node; n && n !== article; n = n.parent)
      if ("attribs" in n && (["aside", "nav", "footer", "header", "template", "noscript"].includes(n.name) ||
        n.attribs.hidden !== undefined || n.attribs["aria-hidden"] === "true" ||
        /recommend|related|ranking|advert|sponsor|(?:^|[-_\s])ads?(?:$|[-_\s])/i.test(`${n.attribs.class || ""} ${n.attribs.id || ""}`))) return true;
    return false;
  };
  const containers = DomUtils.findAll(n => has(n.attribs.class || "", "photo-wrap"), body.children);
  const posts = containers.flatMap(container => DomUtils.findAll(n => n.name === "blockquote", container.children)
    .filter(n => !blocked(n))
    .flatMap(n => {
      const candidates = has(n.attribs.class || "", "instagram-media") && n.attribs["data-instgrm-permalink"]
        ? [n.attribs["data-instgrm-permalink"]]
        : has(n.attribs.class || "", "twitter-tweet")
          ? DomUtils.findAll(a => a.name === "a", n.children).map(a => a.attribs.href || "")
          : [];
      const valid = candidates.map(socialPostUrl).filter((p): p is NonNullable<ReturnType<typeof socialPostUrl>> => !!p);
      return valid.length ? [valid[valid.length - 1]] : [];
    }))
    .filter((p, i, all) => all.findIndex(other => other.url === p.url) === i).slice(0, 12);
  if (!posts.length) return null;
  const title = DomUtils.findOne(n => n.name === "title", doc.children);
  return { kind: "social" as const, posts, title: title ? DomUtils.textContent(title).trim().slice(0, 500) : "" };
}
