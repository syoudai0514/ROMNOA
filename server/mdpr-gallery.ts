import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

// The current photo is omitted from the publisher's ordered thumbnail list.
// Its position is declared in the title and corroborated by the prev/next links.
export function mdprGallery(html: string, pageUrl: string) {
  const page = new URL(pageUrl);
  if (
    page.hostname !== "mdpr.jp" ||
    !/^\/photo\/detail\/\d+$/.test(page.pathname)
  )
    return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  const title = titleNode
    ? DomUtils.textContent(titleNode).trim().slice(0, 500)
    : "";
  const position = title.match(/画像\s*(\d+)\s*\/\s*(\d+)/);
  const current = position ? Number(position[1]) - 1 : -1;
  const count = position ? Number(position[2]) : 0;
  if (!position || count === 1) return null;
  if (count < 2 || count > 80 || current < 0 || current >= count)
    throw Error("gallery_structure_changed");
  const figure = DomUtils.findOne(
    (n) =>
      n.name === "figure" &&
      /(?:^|\s)pg-photo__image(?:\s|$)/.test(n.attribs.class || ""),
    doc.children,
  );
  const list = DomUtils.findOne(
    (n) =>
      n.name === "ol" &&
      /(?:^|\s)pg-photo__webImageList(?:\s|$)/.test(n.attribs.class || ""),
    doc.children,
  );
  if (!figure || !list) throw Error("gallery_structure_changed");
  const imageIn = (root: typeof figure) =>
    DomUtils.findAll((n) => n.name === "img", root.children)
      .map((n) => ({
        node: n,
        url: publicPhotoUrl(
          n.attribs["data-src"] || n.attribs.src || "",
          pageUrl,
        ),
      }))
      .find(
        ({ node, url }) =>
          url &&
          !/imageprotect/i.test(node.attribs.class || "") &&
          !/\/img_protect\./i.test(new URL(url).pathname),
      );
  const image = imageIn(figure);
  const og = DomUtils.findOne(
    (n) => n.name === "meta" && n.attribs.property === "og:image",
    doc.children,
  );
  const ogUrl = og && publicPhotoUrl(og.attribs.content || "", pageUrl);
  if (
    !image?.url ||
    !ogUrl ||
    new URL(image.url).origin !== new URL(ogUrl).origin ||
    new URL(image.url).pathname !== new URL(ogUrl).pathname
  )
    throw Error("gallery_structure_changed");
  const entries = DomUtils.findAll((n) => n.name === "a", list.children).map(
    (anchor) => {
      const url = publicPhotoUrl(anchor.attribs.href || "", pageUrl);
      const thumb = imageIn(anchor);
      if (!url || !thumb?.url) throw Error("gallery_structure_changed");
      const target = new URL(url);
      if (
        target.origin !== page.origin ||
        !/^\/photo\/detail\/\d+$/.test(target.pathname) ||
        target.search ||
        target.hash ||
        target.href === pageUrl
      )
        throw Error("gallery_structure_changed");
      return { pageUrl: url, url: thumb.url };
    },
  );
  if (
    entries.length !== count - 1 ||
    new Set(entries.map((e) => e.pageUrl)).size !== entries.length
  )
    throw Error("gallery_structure_changed");
  entries.splice(current, 0, { pageUrl, url: image.url });
  for (const [direction, index] of [
    ["prev", current - 1],
    ["next", current + 1],
  ] as const) {
    const button = DomUtils.findOne(
      (n) =>
        n.name === "a" &&
        (n.attribs.class || "")
          .split(/\s+/)
          .includes(`c-pager__button--${direction}`),
      doc.children,
    );
    if (
      index >= 0 &&
      index < count &&
      (!button ||
        publicPhotoUrl(button.attribs.href || "", pageUrl) !==
          entries[index].pageUrl)
    )
      throw Error("gallery_structure_changed");
  }
  const captionNode = DomUtils.findOne(
    (n) => n.name === "figcaption",
    figure.children,
  );
  const caption = captionNode
    ? DomUtils.textContent(captionNode)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500)
    : "";
  return {
    kind: "gallery" as const,
    picture: {
      url: image.url,
      alt: image.node.attribs.alt?.slice(0, 500) || caption,
      caption,
    },
    pages: entries.map((e) => e.pageUrl),
    thumbnails: entries,
    title,
  };
}
