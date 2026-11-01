// Generic "thumbnail roster of sibling photo pages" galleries.
//
// Many publishers on unrelated CMSs share the same shape: one HTML page per
// photo, the large photo at the top and a list of thumbnails that link to the
// other photo pages of the same gallery. The sibling pages differ from the
// current page only in the last path segment (/gallery/news/1/media/2) or in
// one numbered query value (?photoid=2, ?image=3). This adapter recognises
// that shape from the markup instead of the host name:
//
// 1. Collect links to sibling pages that wrap a thumbnail image, outside
//    ads / related / ranking regions, and keep the largest roster.
// 2. Require gallery evidence in the URL or in the roster container.
// 3. Locate the current page in the roster (a link to it, or the unlinked
//    current thumbnail) to keep the publisher's order.
// 4. Take the large photo only when its file matches the current thumbnail
//    (same file stem, ignoring size suffixes and resize queries) so a
//    recommendation or logo is never shown as the article's photo.
import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

const MAX_PAGES = 80;
// Query keys used only for tracking / referral. They are ignored when
// comparing a sibling's query with the current page's query.
const tracking =
  /^(?:utm_.*|ref|place|in|from|fm|cx_.*|yhref|car|ctid|nid|ex_id|ex_position|source|rf|cid|n_cid|mod|sc_.*|fbclid|gclid|yclid|_ga|amp)$/i;
const evidence =
  /photo|gallery|galleries|image|img|gazo|picture|pict|media|slide|attachment|thumb|pic|shot/i;
const excluded =
  /(?:^|[-_\s])(?:ad|ads|adunit|advertisement|banner|sponsor|sponsored|pr)(?:$|[-_\s])|related|recommend|ranking|popular|pickup|osusume|newslist|news-list|latest|backnumber|other-?news|more-?news/i;

function blockedNode(node: Element) {
  const a = node.attribs;
  return (
    ["script", "style", "iframe", "footer", "aside", "noscript"].includes(
      node.name,
    ) ||
    a.hidden !== undefined ||
    a["aria-hidden"] === "true" ||
    excluded.test(`${a.id || ""} ${a.class || ""}`)
  );
}
function blockedChain(node: AnyNode) {
  for (let n: AnyNode | null = node; n; n = n.parent)
    if ("attribs" in n && blockedNode(n)) return true;
  return false;
}
function imageSource(img: Element, base: string) {
  const a = img.attribs;
  const srcset = [...(a["data-srcset"] || a.srcset || "").matchAll(
    /(\S+)\s+(\d+(?:\.\d+)?)[wx](?:,|$)/g,
  )].sort((x, y) => Number(y[2]) - Number(x[2]));
  for (const raw of [
    a["data-src"],
    a["data-original"],
    a["data-lazy-src"],
    a["data-lazy"],
    srcset[0]?.[1],
    a.src,
  ]) {
    if (!raw || raw.startsWith("data:")) continue;
    const url = publicPhotoUrl(raw.trim(), base);
    if (url && !/\.(?:svg|ico)(?:[?#]|$)/i.test(url)) return url;
  }
  return null;
}
// File stem without extension and common size/variant suffixes.
export function photoStem(raw: string) {
  try {
    let name = decodeURIComponent(new URL(raw).pathname.split("/").pop() || "")
      .toLowerCase()
      .replace(/\.(?:jpe?g|png|webp|avif|gif)$/, "");
    for (let i = 0; i < 3; i++)
      name = name.replace(
        /(?:[-_.@](?:\d{2,4}x\d{2,4}|\d{2,4}x|w\d{2,4}|h\d{2,4}|\d{2,4}px|thumb|thumbnail|thumbs|small|medium|large|sq|square|crop|x2|2x|[sml]|o|org|orig))+$/,
        "",
      );
    return name.length >= 3 ? name : null;
  } catch {
    return null;
  }
}
function lastSegment(u: URL) {
  const m = u.pathname.match(/^(.*\/)([^/]+)(\/?)$/);
  return m ? { prefix: m[1], id: m[2], slash: m[3] } : null;
}
function meaningfulQuery(u: URL, skip?: string) {
  return [...u.searchParams]
    .filter(([k]) => !tracking.test(k) && k !== skip)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
}
type Key = string;
// Returns the roster key of `link` relative to `base`, or null when the link
// is not a sibling photo page of the current page.
function siblingKey(base: URL, link: URL): { key: Key; id: string } | null {
  if (link.origin !== base.origin || link.hash) return null;
  const a = lastSegment(base),
    b = lastSegment(link);
  if (
    a &&
    b &&
    a.prefix === b.prefix &&
    a.slash === b.slash &&
    /\d/.test(b.id) &&
    /^[\w.%-]{1,120}$/.test(b.id) &&
    a.id.replace(/^.*?(\.[a-z]+)?$/i, "$1") ===
      b.id.replace(/^.*?(\.[a-z]+)?$/i, "$1") &&
    a.prefix.split("/").filter(Boolean).length >= 1 &&
    meaningfulQuery(base) === meaningfulQuery(link)
  )
    return { key: `path:${a.prefix}`, id: b.id };
  if (link.pathname !== base.pathname) return null;
  for (const [k, v] of link.searchParams) {
    if (tracking.test(k) || !/\d/.test(v) || v.length > 120) continue;
    if (meaningfulQuery(base, k) === meaningfulQuery(link, k))
      return { key: `query:${k}`, id: v };
  }
  return null;
}
function currentId(base: URL, key: Key) {
  if (key.startsWith("path:")) return lastSegment(base)?.id ?? null;
  return base.searchParams.get(key.slice(6));
}
const inside = (node: AnyNode, ancestor: AnyNode): boolean => {
  for (let n: AnyNode | null = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
};

export function siblingGallery(html: string, pageUrl: string) {
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const base = new URL(pageUrl);
  const doc = parseDocument(html, { decodeEntities: true });
  const anchors = DomUtils.findAll((n) => n.name === "a", doc.children);
  if (anchors.length > 5000) return null;
  // Group sibling links by the list that holds them, so a large photo that
  // links to the next page is not mistaken for part of the thumbnail roster.
  const holder = (anchor: Element): AnyNode => {
    for (let n = anchor.parent; n && "attribs" in n; n = n.parent)
      if (
        ["ul", "ol"].includes(n.name) ||
        /thumb|list|carousel|slider|swiper|gallery/i.test(
          `${n.attribs.id || ""} ${n.attribs.class || ""}`,
        )
      )
        return n;
    return anchor.parent?.parent || anchor.parent || doc;
  };
  const groups = new Map<
    AnyNode,
    {
      key: Key;
      items: { anchor: Element; id: string; url: string; thumb: string; alt: string }[];
    }[]
  >();
  for (const anchor of anchors) {
    const href = publicPhotoUrl(anchor.attribs.href || "", pageUrl);
    if (!href) continue;
    const sibling = siblingKey(base, new URL(href));
    if (!sibling) continue;
    const img = DomUtils.findOne((n) => n.name === "img", anchor.children);
    const thumb = img && imageSource(img, pageUrl);
    if (!img || !thumb || blockedChain(anchor)) continue;
    const box = holder(anchor);
    const byKey = groups.get(box) || [];
    let group = byKey.find((g) => g.key === sibling.key);
    if (!group) byKey.push((group = { key: sibling.key, items: [] }));
    group.items.push({
      anchor,
      id: sibling.id,
      url: href,
      thumb,
      alt: (img.attribs.alt || "").trim().slice(0, 500),
    });
    groups.set(box, byKey);
  }
  let best: { key: Key; size: number; box: AnyNode; list: { anchor: Element; id: string; url: string; thumb: string; alt: string }[] } | null = null;
  for (const [box, byKey] of groups)
    for (const g of byKey) {
      const size = new Set(g.items.map((e) => e.id)).size;
      if (!best || size > best.size) best = { key: g.key, size, box, list: g.items };
    }
  if (!best) return null;
  const list = best.list;
  const container = best.box;
  const containerLabel = [container, container.parent]
    .map((n) => (n && "attribs" in n ? `${n.attribs.id || ""} ${n.attribs.class || ""}` : ""))
    .join(" ");
  if (!evidence.test(best.key) && !evidence.test(containerLabel)) return null;
  const selfId = currentId(base, best.key);
  if (!selfId) return null;
  // Roster in document order; the current page may be an unlinked thumbnail.
  type Entry = { id: string; url: string; thumb: string; alt: string };
  const entries: Entry[] = [];
  let currentThumb: { thumb: string; alt: string } | null = null;
  const seen = new Set<string>();
  const walk = (node: AnyNode) => {
    if (!("attribs" in node)) return;
    if (blockedNode(node)) return;
    const hit = list.find((e) => e.anchor === node);
    if (hit) {
      if (!seen.has(hit.id)) {
        seen.add(hit.id);
        entries.push(hit);
      }
      return;
    }
    if (node.name === "a") {
      const href = publicPhotoUrl(node.attribs.href || "", pageUrl);
      // A link that is not a sibling (another article) ends this branch.
      if (href && href.split("#")[0] !== pageUrl.split("#")[0]) return;
    }
    if (node.name === "img" && !seen.has(selfId)) {
      const thumb = imageSource(node, pageUrl);
      if (thumb && !currentThumb) {
        currentThumb = { thumb, alt: (node.attribs.alt || "").trim() };
        seen.add(selfId);
        entries.push({ id: selfId, url: pageUrl, ...currentThumb });
      }
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const child of "children" in container ? container.children : [])
    walk(child);
  const current = entries.find((e) => e.id === selfId);
  if (!current || entries.length < 2 || entries.length > MAX_PAGES)
    return null;
  // The large photo: an image outside the roster (or og:image) whose file
  // matches the current thumbnail.
  const stem = photoStem(current.thumb);
  if (!stem) return null;
  let picture: { url: string; alt: string; width: number } | null = null;
  for (const img of DomUtils.findAll((n) => n.name === "img", doc.children)) {
    if (inside(img, container) || blockedChain(img)) continue;
    const url = imageSource(img, pageUrl);
    if (!url || photoStem(url) !== stem) continue;
    const width = Number.parseInt(img.attribs.width || "0") || 0;
    if (!picture || width > picture.width)
      picture = { url, alt: (img.attribs.alt || "").trim(), width };
  }
  if (!picture) {
    const og = DomUtils.findOne(
      (n) =>
        n.name === "meta" &&
        ["og:image", "twitter:image"].includes(
          n.attribs.property || n.attribs.name || "",
        ),
      doc.children,
    );
    const url = og && publicPhotoUrl(og.attribs.content || "", pageUrl);
    if (url && photoStem(url) === stem) picture = { url, alt: "", width: 0 };
  }
  if (!picture) return null;
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  const pages = entries.map((e) => (e.id === selfId ? pageUrl : e.url));
  if (new Set(pages).size !== pages.length) return null;
  const alt = (picture.alt || current.alt).slice(0, 500);
  return {
    kind: "gallery" as const,
    picture: { url: picture.url, alt, caption: alt },
    pages,
    thumbnails: entries.map((e, i) => ({ pageUrl: pages[i], url: e.thumb })),
    title: titleNode ? DomUtils.textContent(titleNode).trim().slice(0, 500) : "",
  };
}
