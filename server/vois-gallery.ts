import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

// WordPress attachment pages link the other photos in the same article but
// omit the current page from that roster. Its heading supplies the position.
export function voisGallery(html: string, pageUrl: string) {
  const page = new URL(pageUrl);
  const match = page.pathname.match(/^\/news\/(\d+)\/([a-z0-9][a-z0-9_-]{0,199})\/$/i);
  if (!/^(?:www\.)?voisjp\.me$/.test(page.hostname) || !match || page.search || page.hash) return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const hasClass = (value: string, cls: string) => value.split(/\s+/).includes(cls);
  const main = DomUtils.findOne((n) => n.name === "div" && hasClass(n.attribs.class || "", "photo-content"), doc.children);
  const list = DomUtils.findOne((n) => n.name === "div" && hasClass(n.attribs.class || "", "siblings-grid"), doc.children);
  const heading = DomUtils.findOne((n) => n.name === "h1" && hasClass(n.attribs.class || "", "photo-title"), doc.children);
  if (!main || !list || !heading) return null;
  const pos = DomUtils.textContent(heading).match(/\((\d+)\s*\/\s*(\d+)\)\s*$/);
  const index = Number(pos?.[1]), total = Number(pos?.[2]);
  if (!pos || total < 2 || total > 40 || index < 1 || index > total) throw Error("gallery_structure_changed");
  const photoKey = (raw: string, slug: string) => {
    const url = publicPhotoUrl(raw, pageUrl);
    if (!url) return null;
    const u = new URL(url);
    const file = u.pathname.split("/").pop() || "";
    const name = file.replace(/\.(?:jpe?g|png|webp|avif)$/i, "").replace(/-\d+x\d+$/i, "");
    return u.origin === page.origin && /^\/wp-content\/uploads\/\d{4}\/\d{2}\//.test(u.pathname) && !u.search && !u.hash && name === slug && /\.(?:jpe?g|png|webp|avif)$/i.test(file) ? url : null;
  };
  const img = DomUtils.findOne((n) => n.name === "img", main.children);
  const full = img && photoKey(img.attribs.src || "", match[2]);
  if (!full) throw Error("gallery_structure_changed");
  const siblings = DomUtils.findAll((n) => n.name === "a" && hasClass(n.attribs.class || "", "sibling-item"), list.children).map((a) => {
    const link = publicPhotoUrl(a.attribs.href || "", pageUrl);
    const thumbNode = DomUtils.findOne((n) => n.name === "img", a.children);
    const u = link ? new URL(link) : null;
    const sibling = u?.pathname.match(/^\/news\/(\d+)\/([a-z0-9][a-z0-9_-]{0,199})\/$/i);
    const thumb = sibling && thumbNode && photoKey(thumbNode.attribs["data-src"] || thumbNode.attribs.src || "", sibling[2]);
    if (!link || !u || u.origin !== page.origin || u.search || u.hash || !sibling || sibling[1] !== match[1] || link === pageUrl || !thumb) throw Error("gallery_structure_changed");
    return { pageUrl: link, url: thumb };
  });
  if (siblings.length !== total - 1 || new Set(siblings.map((item) => item.pageUrl)).size !== siblings.length) throw Error("gallery_structure_changed");
  siblings.splice(index - 1, 0, { pageUrl, url: full });
  const captionNode = DomUtils.findOne((n) => n.name === "figcaption", main.children);
  const caption = captionNode ? DomUtils.textContent(captionNode).replace(/\s+/g, " ").trim().slice(0, 500) : "";
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  const title = titleNode ? DomUtils.textContent(titleNode).trim().slice(0, 500) : "";
  return { kind: "gallery" as const, picture: { url: full, alt: caption, caption }, pages: siblings.map((item) => item.pageUrl), thumbnails: siblings, title };
}
