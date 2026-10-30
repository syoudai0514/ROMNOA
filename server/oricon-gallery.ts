import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
export function oriconGallery(html: string, pageUrl: string) {
  const base = new URL(pageUrl),
    match = base.pathname.match(/^\/news\/(\d+)\/photo\/(\d+)\/$/);
  if (!/(^|\.)oricon\.co\.jp$/.test(base.hostname) || !match) return null;
  const doc = parseDocument(html, { decodeEntities: true });
  const main = DomUtils.findOne(
    (n) => n.attribs.id === "main_photo",
    doc.children,
  );
  const list = DomUtils.findOne(
    (n) =>
      n.name === "ul" &&
      (n.attribs.class || "").split(/\s+/).includes("photo_thumbs"),
    doc.children,
  );
  const current = DomUtils.findOne(
    (n) => n.attribs.id === "param-photo_id",
    doc.children,
  );
  const image =
    main && DomUtils.findOne((n) => n.name === "img", main.children);
  const full = image && publicPhotoUrl(image.attribs.src || "", pageUrl);
  const member = (raw: string) => {
    const u = new URL(raw);
    return (
      u.hostname === "contents.oricon.co.jp" &&
      new RegExp(
        `^/upimg/news/\\d+/${match[1]}/[^/]+\\.(?:jpg|png|webp)$`,
      ).test(u.pathname)
    );
  };
  if (!list || current?.attribs.value !== match[2] || !full || !member(full))
    throw Error("gallery_structure_changed");
  const entries = DomUtils.findAll((n) => n.name === "a", list.children).map(
    (a) => {
      const link = publicPhotoUrl(a.attribs.href || "", pageUrl),
        img = DomUtils.findOne((n) => n.name === "img", a.children);
      const thumb = img && publicPhotoUrl(img.attribs.src || "", pageUrl);
      if (!link || !thumb || !member(thumb))
        throw Error("gallery_structure_changed");
      const u = new URL(link),
        m = u.pathname.match(/^\/news\/(\d+)\/photo\/(\d+)\/$/);
      if (
        u.origin !== base.origin ||
        !m ||
        m[1] !== match[1] ||
        u.search ||
        u.hash
      )
        throw Error("gallery_structure_changed");
      return {
        pageUrl: u.pathname === base.pathname ? pageUrl : link,
        url: thumb,
      };
    },
  );
  if (
    !entries.length ||
    entries.length > 40 ||
    !entries.some((e) => e.pageUrl === pageUrl) ||
    new Set(entries.map((e) => e.pageUrl)).size !== entries.length
  )
    throw Error("gallery_structure_changed");
  const og = DomUtils.findOne(
    (n) => n.name === "meta" && n.attribs.property === "og:image",
    doc.children,
  );
  if (publicPhotoUrl(og?.attribs.content || "", pageUrl) !== full)
    throw Error("gallery_structure_changed");
  const caption = (image?.attribs.alt || "").trim().slice(0, 500);
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  return {
    kind: "gallery" as const,
    picture: { url: full, alt: caption, caption },
    pages: entries.map((e) => e.pageUrl),
    thumbnails: entries,
    title: titleNode
      ? DomUtils.textContent(titleNode).trim().slice(0, 500)
      : "",
  };
}
