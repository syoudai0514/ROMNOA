import { DomUtils, parseDocument } from "htmlparser2";
import { isTag, type Element } from "domhandler";
import type { YahooPicture } from "../src/lib/yahoo-photos-model.js";
import { photoSource } from "./photo-source.js";

function hasClass(node: Element, name: string) {
  return node.attribs.class?.split(/\s+/).includes(name);
}

export function smartFlashPosition(page: URL) {
  if (page.hostname !== "smart-flash.jp") return 0;
  const index = page.pathname.match(/\/\d+\/image\/([1-9]\d?)\/$/)?.[1];
  return Number(index || 0);
}

export function smartFlashGallery(html: string, pageUrl: string) {
  const position = smartFlashPosition(new URL(pageUrl));
  if (!position) return null;
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");

  const doc = parseDocument(html);
  const main = DomUtils.findOne(
    (node) => node.attribs.id === "main" && !!hasClass(node, "pageImageDetail"),
    doc.children,
  );
  if (!main) return null;
  const tracks = DomUtils.findAll(
    (node) =>
      !!hasClass(node, "imageSlider") &&
      !!node.parent &&
      isTag(node.parent) &&
      !!hasClass(node.parent, "newsBlock"),
    main.children,
  );
  if (tracks.length !== 1) return null;
  const slides = tracks[0].children
    .filter(isTag)
    .filter(
      (node) =>
        hasClass(node, "item") && !hasClass(node, "ads_sp_image_slider"),
    );
  if (slides.length < position || slides.length > 80) return null;

  // The pre-rendered slider declares every photo, its caption, and its
  // ordinal. The Open Graph card may point to a different slide's thumbnail.
  const pictures: YahooPicture[] = [];
  for (const [index, slide] of slides.entries()) {
    const counter = DomUtils.findOne(
      (node) => !!hasClass(node, "imageIndex"),
      slide.children,
    );
    if (
      slide.attribs["data-index"] !== String(index + 1) ||
      !counter ||
      DomUtils.textContent(counter).replace(/\s+/g, "") !==
        `${index + 1}/${slides.length}`
    )
      return null;
    const frame = DomUtils.findOne(
      (node) => !!hasClass(node, "imageRatio"),
      slide.children,
    );
    const image =
      frame && DomUtils.findOne((node) => node.name === "img", frame.children);
    const url = image && photoSource(image, pageUrl);
    if (
      !url ||
      !image ||
      !/^https:\/\/data\.smart-flash\.jp\/wp-content\/uploads\/[^?#]+\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(
        url,
      )
    )
      return null;
    const caption = DomUtils.findOne(
      (node) => !!hasClass(node, "imageCaption"),
      slide.children,
    );
    pictures.push({
      url,
      alt: (image.attribs.alt || "").trim().slice(0, 500),
      caption: caption
        ? DomUtils.textContent(caption).trim().slice(0, 500)
        : undefined,
    });
  }
  const current = position - 1;
  const pages = pictures.map((_, i) =>
    i === current
      ? pageUrl
      : `${pageUrl.split("#")[0]}#romnoa-photo-${i < current ? i + 2 : i + 1}`,
  );
  const title = DomUtils.findOne((node) => node.name === "title", doc.children);
  return {
    kind: "gallery" as const,
    picture: pictures[current],
    pictures,
    pages,
    thumbnails: pictures.map((picture, i) => ({
      pageUrl: pages[i],
      url: picture.url,
    })),
    title: title ? DomUtils.textContent(title).trim().slice(0, 500) : "",
  };
}
