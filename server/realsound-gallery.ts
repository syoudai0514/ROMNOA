import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

export function realSoundImageKey(raw: string, base: string) {
  const url = publicPhotoUrl(raw, base);
  if (!url) return null;
  const u = new URL(url);
  if (u.origin !== new URL(base).origin || u.search || u.hash || !/^\/wp-content\/uploads\/\d{4}\/\d{2}\//.test(u.pathname)) return null;
  const filename = u.pathname.split("/").pop() || "";
  const match = filename.match(/^([A-Za-z0-9_-]+?)(?:-\d{1,5}x\d{1,5})?\.(?:jpe?g|png|webp|avif)(?:\.webp)?$/i);
  return match ? match[1] : null;
}
export function realSoundGallery(html: string, pageUrl: string) {
  const page = new URL(pageUrl);
  const match = page.pathname.match(/^(\/(?:[a-z-]+\/)?\d{4}\/\d{2}\/post-\d+\.html)\/photo\/([A-Za-z0-9_-]+)$/i);
  if (page.hostname !== "realsound.jp" || !match || page.search || page.hash) return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const hasClass = (s: string, name: string) => s.split(/\s+/).includes(name);
  const main = DomUtils.findOne((n) => n.name === "figure" && hasClass(n.attribs.class || "", "attachment-img"), doc.children);
  const roster = DomUtils.findOne((n) => n.name === "div" && hasClass(n.attribs.class || "", "attachment-list-imgs"), doc.children);
  if (!main || !roster) return null;
  const fullNode = DomUtils.findOne((n) => n.name === "img", main.children);
  const full = fullNode && publicPhotoUrl(fullNode.attribs.src || "", pageUrl);
  if (!full || realSoundImageKey(full, pageUrl) !== match[2]) throw Error("gallery_structure_changed");
  const entries = DomUtils.findAll((n) => n.name === "a", roster.children).map((anchor) => {
    const link = publicPhotoUrl(anchor.attribs.href || "", pageUrl);
    const thumbNode = DomUtils.findOne((n) => n.name === "img", anchor.children);
    const thumb = thumbNode && publicPhotoUrl(thumbNode.attribs.src || "", pageUrl);
    const target = link ? new URL(link) : null;
    const photo = target?.pathname.match(/^(.*)\/photo\/([A-Za-z0-9_-]+)$/i);
    if (!link || !target || target.origin !== page.origin || target.search || target.hash || !photo || photo[1] !== match[1] || !thumb || realSoundImageKey(thumb, pageUrl) !== photo[2]) throw Error("gallery_structure_changed");
    return { pageUrl: link, url: thumb };
  });
  const countNode = DomUtils.findOne((n) => hasClass(n.attribs.class || "", "attachment-caption-number"), main.children);
  const count = countNode && DomUtils.textContent(countNode).normalize("NFKC").match(/画像\s*(\d+)\s*\/\s*(\d+)/);
  const index = entries.findIndex((entry) => entry.pageUrl === pageUrl);
  if (!count || entries.length < 1 || entries.length > 80 || entries.length !== Number(count[2]) || index !== Number(count[1]) - 1 || new Set(entries.map((entry) => entry.pageUrl)).size !== entries.length || new Set(entries.map((entry) => realSoundImageKey(entry.url, pageUrl))).size !== entries.length) throw Error("gallery_structure_changed");
  const captionNode = DomUtils.findOne((n) => hasClass(n.attribs.class || "", "attachment-caption"), main.children);
  const caption = captionNode ? DomUtils.textContent(captionNode).replace(/\s+/g, " ").trim().slice(0, 500) : "";
  const alt = (fullNode?.attribs.alt || "").trim().slice(0, 500);
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  return { kind: "gallery" as const, picture: { url: full, alt, caption }, pages: entries.map((entry) => entry.pageUrl), thumbnails: entries, title: titleNode ? DomUtils.textContent(titleNode).trim().slice(0, 500) : "" };
}
