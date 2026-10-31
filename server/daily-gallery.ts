import { DomUtils, parseDocument } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

// Daily declares every photo page in the article's thumbnail wrapper. The
// selected page supplies its full-size image; the image IDs are not assumed.
export function dailyGallery(html: string, pageUrl: string) {
  const base = new URL(pageUrl);
  if (
    base.hostname !== "www.daily.co.jp" ||
    !/^\/.+\/\d{4}\/\d{2}\/\d{2}\/\d+\.shtml$/.test(base.pathname) ||
    [...base.searchParams.keys()].some((k) => k !== "ph") ||
    base.searchParams.getAll("ph").length !== 1 ||
    base.hash ||
    !/^[1-9]\d*$/.test(base.searchParams.get("ph") || "")
  )
    return null;
  const doc = parseDocument(html, { decodeEntities: true });
  const content = DomUtils.findOne(
    (n) => (n.attribs.class || "").split(/\s+/).includes("photoContent"),
    doc.children,
  );
  const figure =
    content &&
    DomUtils.findOne(
      (n) =>
        n.name === "figure" &&
        (n.attribs.class || "").split(/\s+/).includes("photoItem"),
      content.children,
    );
  const image =
    figure && DomUtils.findOne((n) => n.name === "img", figure.children);
  const full = image && publicPhotoUrl(image.attribs.src || "", pageUrl);
  const list =
    content &&
    DomUtils.findOne(
      (n) => (n.attribs.class || "").split(/\s+/).includes("thumb-wrapper"),
      content.children,
    );
  const imageKey = (raw: string, prefix: "f" | "b") => {
    const u = new URL(raw);
    if (u.hostname !== "i.daily.jp" || u.search || u.hash) return null;
    return (
      u.pathname
        .match(new RegExp(`^(.*/Images/)${prefix}_(\\d+)\\.jpe?g$`, "i"))
        ?.slice(1)
        .join(":") || null
    );
  };
  if (!figure || !image || !full || !list || !imageKey(full, "f"))
    throw Error("gallery_structure_changed");
  const entries = DomUtils.findAll((n) => n.name === "a", list.children).map(
    (a) => {
      const link = publicPhotoUrl(a.attribs.href || "", pageUrl);
      const img = DomUtils.findOne((n) => n.name === "img", a.children);
      const thumb = img && publicPhotoUrl(img.attribs.src || "", pageUrl);
      if (!link || !thumb || !imageKey(thumb, "b"))
        throw Error("gallery_structure_changed");
      const u = new URL(link);
      if (
        u.origin !== base.origin ||
        u.pathname !== base.pathname ||
        u.hash ||
        [...u.searchParams.keys()].some((k) => k !== "ph") ||
        u.searchParams.getAll("ph").length !== 1 ||
        !/^[1-9]\d*$/.test(u.searchParams.get("ph") || "")
      )
        throw Error("gallery_structure_changed");
      return { pageUrl: u.href, url: thumb };
    },
  );
  const selected = entries.find((e) => e.pageUrl === pageUrl);
  if (
    !entries.length ||
    entries.length > 40 ||
    !selected ||
    new Set(entries.map((e) => e.pageUrl)).size !== entries.length ||
    imageKey(selected.url, "b") !== imageKey(full, "f")
  )
    throw Error("gallery_structure_changed");
  const captionNode = DomUtils.findOne(
    (n) => n.name === "figcaption",
    figure.children,
  );
  const alt = (image.attribs.alt || "").trim().slice(0, 500);
  const caption = captionNode
    ? DomUtils.textContent(captionNode)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500)
    : alt;
  const title = DomUtils.findOne((n) => n.name === "title", doc.children);
  return {
    kind: "gallery" as const,
    picture: { url: full, alt, caption },
    pages: entries.map((e) => e.pageUrl),
    thumbnails: entries,
    title: title ? DomUtils.textContent(title).trim().slice(0, 500) : "",
  };
}
