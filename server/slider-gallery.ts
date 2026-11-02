// Galleries rendered as a carousel inside one document (splide, swiper,
// slick, Smart Slider 3). Every photo is already in the server HTML; the
// carousel script only moves between them. Recognised from the carousel
// markup, not from the host name:
//
// - slides of one carousel track, excluding clones made for looping
// - each slide holds one photo (an <img>, or Smart Slider's data-desktop)
// - carousels whose slides link to other pages are recommendation widgets
//   and are ignored, as are carousels inside ad / related / ranking regions
// - the selected photo comes from the page's own position query (?pn=3,
//   ?photo=2, ?image=2) when present, otherwise the first slide
import { parseDocument, DomUtils } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
import type { YahooPicture } from "../src/lib/yahoo-photos-model.js";

import { photoIdentity, photoSource } from "./photo-source.js";

// Ad / recommendation regions. Ad markers are matched per class token so a
// page-level modifier such as "--ad-gate" does not hide the whole page.
const adToken =
  /^(?:ad|ads|adunit|advertisement|banner|sponsor|sponsored|pr|ad[-_].+|.+[-_]ads?)$/i;
const excluded =
  /related|recommend|ranking|popular|pickup|osusume|widget|latest|lastest|backnumber/i;
const track =
  /(?:^|\s)(?:splide__list|swiper-wrapper|slick-track|glide__slides|n2-ss-slider-[0-9]+|n2-ss-slide-backgrounds|n2-ss-slider|keen-slider)(?:\s|$)/;
const slide =
  /(?:^|\s)(?:splide__slide|swiper-slide|slick-slide|glide__slide|n2-ss-slide|keen-slider__slide)(?:\s|$)/;
const clone =
  /(?:^|\s)(?:splide__slide--clone|swiper-slide-duplicate|slick-cloned|glide__slide--clone)(?:\s|$)/;

function blocked(node: AnyNode) {
  for (let n: AnyNode | null = node; n; n = n.parent)
    if (
      "attribs" in n &&
      (["aside", "footer", "nav", "header"].includes(n.name) ||
        excluded.test(`${n.attribs.id || ""} ${n.attribs.class || ""}`) ||
        `${n.attribs.id || ""} ${n.attribs.class || ""}`
          .split(/\s+/)
          .some((t) => adToken.test(t)))
    )
      return true;
  return false;
}
const source = photoSource;
function slidePhoto(node: Element, base: string): YahooPicture | null {
  // Smart Slider 3 keeps the full photo on a background element.
  const bg = DomUtils.findOne(
    (n) => !!n.attribs["data-desktop"],
    node.children,
  );
  if (bg) {
    const url = publicPhotoUrl(
      bg.attribs["data-desktop"].replace(/^\/\//, "https://"),
      base,
    );
    const alt = (node.attribs["data-title"] || "").trim().slice(0, 500);
    if (url) return { url, alt, caption: alt };
  }
  const img = DomUtils.findOne((n) => n.name === "img", node.children);
  const url = img && source(img, base);
  if (!img || !url) return null;
  const alt = (img.attribs.alt || "").trim().slice(0, 500);
  return { url, alt, caption: alt };
}

export function sliderGallery(html: string, pageUrl: string) {
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  if (!/splide__list|swiper-wrapper|slick-track|glide__slides|n2-ss-slide|keen-slider/.test(html))
    return null;
  const doc = parseDocument(html, { decodeEntities: true });
  const base = new URL(pageUrl);
  // Prefer the track containing the page's declared main photograph, then
  // a track explicitly identified as this article's photo gallery.
  const mainImages = DomUtils.findAll(n => n.name === "meta" &&
    ["og:image", "twitter:image"].includes(n.attribs.property || n.attribs.name || ""), doc.children)
    .map(n => publicPhotoUrl(n.attribs.content || "", pageUrl)).filter(Boolean)
    .map(u => photoIdentity(u!));
  let best: { pictures: YahooPicture[]; thumbs: string[]; score: number } | null = null;
  const containers = DomUtils.findAll(
    (n) => track.test(n.attribs.class || ""), doc.children,
  ).filter(n => !blocked(n));
  for (const container of containers) {
    if (blocked(container)) continue;
    const slides = DomUtils.findAll(
      (n) =>
        slide.test(n.attribs.class || "") &&
        !clone.test(n.attribs.class || ""),
      container.children,
    ).filter(
      // Only the outermost slide elements of this track.
      (n) => {
        for (let p = n.parent; p && p !== container; p = p.parent)
          if ("attribs" in p && slide.test(p.attribs.class || "")) return false;
        return true;
      },
    );
    // A slide whose photo links to another document is a story card (some
    // carousels append "next article" cards after the photos). Drop those
    // slides; caption credit links such as "Wikimedia Commons" are kept.
    const storyCard = (s: Element) =>
      DomUtils.findAll(
        (n) =>
          n.name === "a" &&
          !!DomUtils.findOne(
            (m) => m.name === "img" || !!m.attribs["data-desktop"],
            n.children,
          ),
        s.children,
      ).some((a) => {
        const href = publicPhotoUrl(a.attribs.href || "", pageUrl);
        return (
          !!href &&
          href.split("#")[0] !== pageUrl.split("#")[0] &&
          !/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(href)
        );
      });
    const photoSlides = slides.filter((s) => !storyCard(s));
    const pictures: YahooPicture[] = [],
      thumbs: string[] = [];
    for (const s of photoSlides) {
      const photo = slidePhoto(s, pageUrl);
      if (photo && !pictures.some((p) => p.url === photo.url)) {
        pictures.push(photo);
        thumbs.push(
          s.attribs["data-thumbnail"]?.replace(/^\/\//, "https://") || "",
        );
      }
    }
    let galleryEvidence = false;
    for (let n: AnyNode | null = container; n; n = n.parent)
      if ("attribs" in n && /(?:photo|gallery|photolibrary|article[-_]images)/i.test(`${n.attribs.class || ""} ${n.attribs.id || ""}`)) galleryEvidence = true;
    const matchesMain = pictures.some(p => mainImages.includes(photoIdentity(p.url)));
    // A single carousel on an explicitly named photo endpoint is also
    // evidence. Do not use that shortcut to arbitrate multiple tracks.
    const photoEndpoint = /\/(?:photos?|images?|gallery|galleries)(?:\/|$)/i.test(base.pathname);
    const score = (matchesMain ? 4 : 0) + (galleryEvidence ? 2 : 0) +
      (containers.length === 1 && photoEndpoint ? 1 : 0);
    if (pictures.length >= 2 && score > 0 && (!best || score > best.score))
      best = { pictures, thumbs, score };
  }
  if (!best || best.pictures.length > 40) return null;
  const position = Number(
    ["pn", "photo", "photoid", "image", "img", "p"]
      .map((k) => base.searchParams.get(k))
      .find((v) => v && /^\d{1,3}$/.test(v)) || 1,
  );
  const current =
    position >= 1 && position <= best.pictures.length ? position - 1 : 0;
  const pages = best.pictures.map((_, i) =>
    i === current
      ? pageUrl
      : `${pageUrl.split("#")[0]}#romnoa-photo-${i < current ? i + 2 : i + 1}`,
  );
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  return {
    kind: "gallery" as const,
    picture: best.pictures[current],
    pictures: best.pictures,
    pages,
    thumbnails: best.pictures.map((p, i) => ({
      pageUrl: pages[i],
      url: publicPhotoUrl(best!.thumbs[i] || "", pageUrl) || p.url,
    })),
    title: titleNode ? DomUtils.textContent(titleNode).trim().slice(0, 500) : "",
  };
}
