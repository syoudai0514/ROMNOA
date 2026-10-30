import { DomUtils, parseDocument } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

// Photo navigation is a publisher-provided roster; thumbnails are CSS backgrounds.
export function nikkansportsGallery(html: string, pageUrl: string) {
  const base = new URL(pageUrl);
  const match = base.pathname.match(
    /^(.*\/photonews\/photonews_nsInc_)(\d+)-(\d+)\.html$/,
  );
  if (
    base.hostname !== "www.nikkansports.com" ||
    !match ||
    base.search ||
    base.hash
  )
    return null;
  const doc = parseDocument(html, { decodeEntities: true });
  const main = DomUtils.findOne(
    (n) => n.attribs.id === "bigPhoto",
    doc.children,
  );
  const list =
    main &&
    DomUtils.findOne(
      (n) => n.attribs.id === "miniPhotoListWrap",
      main.children,
    );
  const big =
    main &&
    DomUtils.findOne(
      (n) => (n.attribs.class || "").split(/\s+/).includes("big-photo"),
      main.children,
    );
  const image = big && DomUtils.findOne((n) => n.name === "img", big.children);
  const full = image && publicPhotoUrl(image.attribs.src || "", pageUrl);
  // Match a full image and every thumbnail to the article and photo number.
  const validImage = (url: string, index: string) => {
    const u = new URL(url);
    return (
      u.origin === base.origin &&
      new RegExp(`/news/img/${match[2]}-w\\d+_${index}\\.jpe?g$`, "i").test(
        u.pathname,
      ) &&
      !u.search &&
      !u.hash
    );
  };
  if (!list || !full || !validImage(full, match[3]))
    throw Error("gallery_structure_changed");
  const entries = DomUtils.findAll((n) => n.name === "a", list.children).map(
    (a) => {
      const link = publicPhotoUrl(a.attribs.href || "", pageUrl);
      const thumbNode = DomUtils.findOne((n) => n.name === "img", a.children);
      const raw = thumbNode?.attribs.style?.match(
        /background-image\s*:\s*url\(\s*['"]?([^'"\s)]+)/i,
      )?.[1];
      const thumb = raw && publicPhotoUrl(raw, pageUrl);
      if (!link || !thumb) throw Error("gallery_structure_changed");
      const u = new URL(link);
      const m = u.pathname.match(
        /^(.*\/photonews\/photonews_nsInc_)(\d+)-(\d+)\.html$/,
      );
      if (
        u.origin !== base.origin ||
        u.search ||
        u.hash ||
        !m ||
        m[1] !== match[1] ||
        m[2] !== match[2] ||
        !validImage(thumb, m[3])
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
  const caption = (image?.attribs.alt || "").trim().slice(0, 500);
  const title = DomUtils.findOne((n) => n.name === "title", doc.children);
  return {
    kind: "gallery" as const,
    picture: { url: full, alt: caption, caption },
    pages: entries.map((e) => e.pageUrl),
    thumbnails: entries,
    title: title ? DomUtils.textContent(title).trim().slice(0, 500) : "",
  };
}
