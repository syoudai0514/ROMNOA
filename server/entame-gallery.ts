import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

export function entamePhotoKey(raw: string, articleId: string) {
  const u = new URL(raw);
  const match = u.pathname.match(
    /^\/articles_photos\/\d+\/(\d+)\/[^/]+\/([a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|avif))$/i,
  );
  return match && match[1] === articleId
    ? `${u.origin}/${match[1]}/${match[2]}`
    : null;
}
export function entameGallery(html: string, pageUrl: string) {
  const page = new URL(pageUrl);
  const match = page.pathname.match(/^\/articles\/gallery\/(\d+)\/(\d+)$/);
  if (page.hostname !== "entamenext.com" || !match) return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const articleId = match[1];
  const doc = parseDocument(html, { decodeEntities: true });
  const hasClass = (value: string, cls: string) =>
    value.split(/\s+/).includes(cls);
  const main = DomUtils.findOne(
    (n) =>
      n.name === "div" && hasClass(n.attribs.class || "", "articleGalleryImg"),
    doc.children,
  );
  const list = DomUtils.findOne(
    (n) =>
      n.name === "div" && hasClass(n.attribs.class || "", "articleGalleryList"),
    doc.children,
  );
  if (!main || !list) throw Error("gallery_structure_changed");
  const anchor = DomUtils.findOne((n) => n.name === "a", main.children);
  const full = anchor && publicPhotoUrl(anchor.attribs.href || "", pageUrl);
  const fullKey = full && entamePhotoKey(full, articleId);
  if (!full || !fullKey || !/\/ORG\//.test(new URL(full).pathname))
    throw Error("gallery_structure_changed");
  const entries = DomUtils.findAll((n) => n.name === "a", list.children).map(
    (a) => {
      const link = publicPhotoUrl(a.attribs.href || "", pageUrl);
      const thumbNode = DomUtils.findOne(
        (n) =>
          !!n.attribs.style && /background-image\s*:/i.test(n.attribs.style),
        a.children,
      );
      const raw = thumbNode?.attribs.style.match(
        /background-image\s*:\s*url\(\s*['"]?([^\s'"\)]+)['"]?\s*\)/i,
      )?.[1];
      const thumb = raw && publicPhotoUrl(raw, pageUrl);
      if (!link || !thumb || !entamePhotoKey(thumb, articleId))
        throw Error("gallery_structure_changed");
      const target = new URL(link);
      if (
        target.origin !== page.origin ||
        !new RegExp(`^/articles/gallery/${articleId}/\\d+$`).test(
          target.pathname,
        ) ||
        target.search ||
        target.hash
      )
        throw Error("gallery_structure_changed");
      return { pageUrl: link, url: thumb };
    },
  );
  const index = entries.findIndex(
    (e) => entamePhotoKey(e.url, articleId) === fullKey,
  );
  if (
    !entries.length ||
    entries.length > 40 ||
    index < 0 ||
    new Set(entries.map((e) => e.pageUrl)).size !== entries.length ||
    new Set(entries.map((e) => entamePhotoKey(e.url, articleId))).size !==
      entries.length
  )
    throw Error("gallery_structure_changed");
  entries[index] = { ...entries[index], pageUrl };
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  const title = titleNode
    ? DomUtils.textContent(titleNode).trim().slice(0, 500)
    : "";
  const captionNode = DomUtils.findOne(
    (n) => n.name === "p" && hasClass(n.attribs.class || "", "meta"),
    main.children,
  );
  const caption = captionNode
    ? DomUtils.textContent(captionNode)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500)
    : "";
  return {
    kind: "gallery" as const,
    picture: { url: full, alt: caption, caption },
    pages: entries.map((e) => e.pageUrl),
    thumbnails: entries,
    title,
  };
}
