import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
export function declaredGallery(html: string, pageUrl: string) {
  const base = new URL(pageUrl),
    doc = parseDocument(html, { decodeEntities: true });
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  const title = titleNode
    ? DomUtils.textContent(titleNode).trim().slice(0, 500)
    : "";
  // CMS-delivered JSON roster; parse data only, never execute publisher JS.
  const roster = html.match(/window\.GALLERY\.photos\s*=\s*(\[[\s\S]*?\]);/);
  if (roster) {
    const total = Number(html.match(/window\.GALLERY\.total\s*=\s*(\d+)/)?.[1]);
    const selected =
      Number(html.match(/window\.GALLERY\.page\s*=\s*(\d+)/)?.[1]) - 1;
    const data = JSON.parse(roster[1]);
    if (
      !Array.isArray(data) ||
      total < 1 ||
      total > 40 ||
      data.length !== total ||
      !Number.isInteger(selected) ||
      selected < 0 ||
      selected >= total
    )
      throw Error("incomplete_gallery");
    const pictures = data.map((p) => {
      const url = publicPhotoUrl(p?.imgx2 || p?.imgx1 || "", pageUrl);
      const small = publicPhotoUrl(p?.imgx1 || "", pageUrl);
      if (
        !url ||
        !small ||
        new URL(url).origin !== new URL(small).origin ||
        new URL(url).pathname.split("/").pop() !==
          new URL(small).pathname.split("/").pop()
      )
        throw Error("gallery_structure_changed");
      return {
        url,
        alt:
          typeof p.caption === "string"
            ? DomUtils.textContent(parseDocument(p.caption))
                .trim()
                .slice(0, 500)
            : "",
      };
    });
    const body = DomUtils.findOne(
      (n) => (n.attribs.class || "").split(/\s+/).includes("js-gallery-body"),
      doc.children,
    );
    const img =
      body &&
      DomUtils.findOne(
        (n) => n.name === "img" && !!n.attribs["data-gallery-src"],
        body.children,
      );
    if (
      !img ||
      publicPhotoUrl(img.attribs["data-gallery-src"], pageUrl) !==
        pictures[selected].url
    )
      throw Error("gallery_structure_changed");
    return result(pictures, selected);
  }
  // A gallery may render the selected figure first and the remaining numbered
  // figures below it. Reconstruct the declared sequence, never DOM order.
  const numbered = DomUtils.findAll(
    (n) => n.name === "figure" && /gallery/i.test(n.attribs.class || ""),
    doc.children,
  ).flatMap((figure) => {
    const counter = DomUtils.findOne(
      (n) => /(?:numb|count|index)/i.test(n.attribs.class || ""),
      figure.children,
    );
    const match =
      counter &&
      DomUtils.textContent(counter)
        .normalize("NFKC")
        .match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return [];
    const image = DomUtils.findOne((n) => n.name === "img", figure.children);
    const url =
      image &&
      publicPhotoUrl(
        image.attribs["data-src"] || image.attribs.src || "",
        pageUrl,
      );
    if (!url) throw Error("gallery_structure_changed");
    return [
      {
        index: Number(match[1]),
        total: Number(match[2]),
        url,
        alt: (image?.attribs.alt || "").slice(0, 500),
      },
    ];
  });
  if (numbered.length > 1) {
    const total = numbered[0].total;
    numbered.sort((a, b) => a.index - b.index);
    if (
      total > 40 ||
      numbered.length !== total ||
      numbered.some((p, i) => p.total !== total || p.index !== i + 1)
    )
      throw Error("incomplete_gallery");
    const selected =
      Number(
        base.searchParams.get("photoid") ||
          base.searchParams.get("image") ||
          base.searchParams.get("pn") ||
          1,
      ) - 1;
    if (!Number.isInteger(selected) || selected < 0 || selected >= total)
      throw Error("gallery_structure_changed");
    return result(
      numbered.map(({ url, alt }) => ({ url, alt })),
      selected,
    );
  }
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
