import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
export function declaredGallery(html: string, pageUrl: string) {
  const base = new URL(pageUrl),
    doc = parseDocument(html, { decodeEntities: true });
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  const title = titleNode
    ? DomUtils.textContent(titleNode).trim().slice(0, 500)
    : "";
  const slides = DomUtils.findAll(
    (n) =>
      (n.attribs.class || "").split(/\s+/).includes("js-article-gallery-item"),
    doc.children,
  );
  if (slides.length > 1) {
    const entries = slides.map((slide, i) => {
      const u = publicPhotoUrl(slide.attribs["data-url"] || "", pageUrl);
      const image = DomUtils.findOne(
        (n) => n.name === "figure",
        slide.children,
      );
      const img =
        image && DomUtils.findOne((n) => n.name === "img", image.children);
      const src =
        img &&
        publicPhotoUrl(
          img.attribs["data-src"] || img.attribs.src || "",
          pageUrl,
        );
      const caption =
        image &&
        DomUtils.findOne((n) => n.name === "figcaption", image.children);
      if (
        !u ||
        !src ||
        Number(slide.attribs["data-num"]) !== i + 1 ||
        new URL(u).origin !== base.origin ||
        new URL(u).pathname !== base.pathname
      )
        throw Error("gallery_structure_changed");
      return {
        url: src,
        alt: caption
          ? DomUtils.textContent(caption).trim().slice(0, 500)
          : img?.attribs.alt?.slice(0, 500) || "",
      };
    });
    const index = Math.max(0, Number(base.searchParams.get("image") || 1) - 1);
    if (index >= entries.length || entries.length > 40)
      throw Error("gallery_structure_changed");
    return result(entries, index);
  }
  // ImageGallery is stronger evidence than a NewsArticle cover. Require every
  // declared image to occur in one explicit carousel, in the same order.
  const carousels = DomUtils.findAll(
    (n) => (n.attribs.class || "").split(/\s+/).includes("js-carousel-slider"),
    doc.children,
  );
  for (const script of DomUtils.findAll(
    (n) => n.name === "script" && n.attribs.type === "application/ld+json",
    doc.children,
  )) {
    let data;
    try {
      data = JSON.parse(DomUtils.textContent(script));
    } catch {
      continue;
    }
    if (data?.["@type"] !== "ImageGallery" || !Array.isArray(data.image))
      continue;
    const urls = data.image.map((v: any) =>
      publicPhotoUrl(
        typeof v === "string" ? v : v?.contentUrl || v?.url || "",
        pageUrl,
      ),
    );
    if (
      urls.length < 2 ||
      urls.length > 40 ||
      urls.some((u: any) => !u) ||
      new Set(urls).size !== urls.length
    )
      continue;
    for (const carousel of carousels) {
      const images = DomUtils.findAll(
        (n) => n.name === "img" && !!n.attribs["data-increment"],
        carousel.children,
      );
      if (
        images.length !== urls.length ||
        images.some(
          (n, i) =>
            Number(n.attribs["data-increment"]) !== i + 1 ||
            publicPhotoUrl(n.attribs.src || "", pageUrl) !== urls[i],
        )
      )
        continue;
      return result(
        images.map((n, i) => ({
          url: urls[i]!,
          alt: (n.attribs.alt || "").slice(0, 500),
        })),
        0,
      );
    }
  }
  return null;
  function result(pictures: { url: string; alt: string }[], current: number) {
    const pages = pictures.map((_, i) =>
      i === current
        ? pageUrl
        : `${pageUrl}#romnoa-photo-${i < current ? i + 2 : i + 1}`,
    );
    return {
      kind: "gallery" as const,
      picture: pictures[current],
      pictures,
      pages,
      thumbnails: pictures.map((p, i) => ({ pageUrl: pages[i], url: p.url })),
      title,
    };
  }
}
