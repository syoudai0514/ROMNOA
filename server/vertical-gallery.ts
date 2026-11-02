// "Vertical gallery" photo pages (LIMO and other sites on the same CMS):
// the photo page shows one photo with a declared position ("1/4") and a
// "もっと見る" button to the article; the remaining photos are only in the
// article body. Read the article the page itself links to, and accept its
// photos only if they contain the photo shown here and at least the
// declared count. Otherwise report the gallery as incomplete.
import { parseDocument, DomUtils } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model.js";
import { parseLinkedPhotos } from "./linked-photo-parser.js";
import { photoIdentity as photoStem } from "./photo-source.js";

const has = (n: { attribs: Record<string, string> }, c: string) =>
  (n.attribs.class || "").split(/\s+/).includes(c);

export async function verticalGallery(
  html: string,
  pageUrl: string,
  load: (url: string) => Promise<string>,
) {
  if (!html.includes("vertical-gallery__current")) return null;
  const doc = parseDocument(html, { decodeEntities: true });
  const box = DomUtils.findOne((n) => has(n, "vertical-gallery"), doc.children);
  const counter =
    box && DomUtils.findOne((n) => has(n, "vertical-gallery__current"), box.children);
  const declared = counter
    ? DomUtils.textContent(counter).normalize("NFKC").match(/(\d+)\s*\/\s*(\d+)/)
    : null;
  const img =
    box && DomUtils.findOne((n) => n.name === "img", box.children);
  const shown =
    img &&
    publicPhotoUrl(
      [...(img.attribs["data-srcset"] || "").matchAll(/(\S+?)\s+(\d+(?:\.\d+)?)[wx](?:,|$)/g)]
        .sort((a, b) => Number(b[2]) - Number(a[2]))[0]?.[1] ||
        img.attribs["data-src"] ||
        img.attribs.src ||
        "",
      pageUrl,
    );
  if (!box || !declared || !shown) return null;
  const index = Number(declared[1]),
    total = Number(declared[2]);
  if (!(index >= 1 && index <= total && total <= 40)) return null;
  const alt = (img!.attribs.alt || "").trim().slice(0, 500);
  const titleNode = DomUtils.findOne((n) => n.name === "title", doc.children);
  const title = titleNode ? DomUtils.textContent(titleNode).trim().slice(0, 500) : "";
  const single = {
    kind: "gallery" as const,
    picture: { url: shown, alt, caption: alt },
    pictures: [{ url: shown, alt, caption: alt }],
    pages: [pageUrl],
    thumbnails: [{ pageUrl, url: shown }],
    title,
    truncated: total > 1,
  };
  if (total === 1) return single;
  // The article this page links to with its own "read more" button.
  const button = DomUtils.findAll((n) => n.name === "a", doc.children)
    .map((a) => publicPhotoUrl(a.attribs.href || "", pageUrl))
    .map((u) => (u ? linkedPhotoTarget(u)?.url : null))
    .find(
      (u) =>
        !!u &&
        new URL(u).origin === new URL(pageUrl).origin &&
        new URL(u).pathname.split("/").pop() ===
          new URL(pageUrl).pathname.split("/").pop() &&
        new URL(u).pathname !== new URL(pageUrl).pathname,
    );
  if (!button) return single;
  const stem = photoStem(shown);
  if (!stem) return single;
  // The article body may continue on numbered pages of the same article
  // (rel="next" → ?page=2). Follow only those, up to five pages.
  let photos: { url: string; alt: string; caption?: string }[] = [];
  let next: string | null = button;
  for (let hop = 0; next && hop < 5; hop++) {
    let articleHtml: string;
    const current: string = next;
    try {
      articleHtml = await load(current);
      for (const p of parseLinkedPhotos(articleHtml, current).pictures)
        if (!photos.some((q) => photoStem(q.url) === photoStem(p.url)))
          photos.push(p);
    } catch {
      break;
    }
    const at = photos.findIndex((p) => photoStem(p.url) === stem);
    if (at >= 0 && photos.length - (at - (index - 1)) >= total) break;
    const rel = DomUtils.findOne(
      (n) => n.name === "link" && n.attribs.rel === "next",
      parseDocument(articleHtml).children,
    );
    const candidate: string | null = rel ? publicPhotoUrl(rel.attribs.href || "", current) : null;
    next =
      candidate &&
      new URL(candidate).origin === new URL(button).origin &&
      new URL(candidate).pathname === new URL(button).pathname &&
      linkedPhotoTarget(candidate)?.url === candidate
        ? candidate
        : null;
  }
  const at = photos.findIndex((p) => photoStem(p.url) === stem);
  if (at < 0) return single;
  const list = photos.slice(at - (index - 1), at - (index - 1) + total);
  if (at - (index - 1) < 0 || list.length < 2) return single;
  const current = index - 1;
  const pages = list.map((_, i) =>
    i === current
      ? pageUrl
      : `${pageUrl.split("#")[0]}#romnoa-photo-${i < current ? i + 2 : i + 1}`,
  );
  const pictures = list.map((p, i) =>
    i === current ? { url: shown, alt, caption: alt } : { ...p, caption: p.caption ?? p.alt },
  );
  return {
    kind: "gallery" as const,
    picture: pictures[current],
    pictures,
    pages,
    thumbnails: pictures.map((p, i) => ({ pageUrl: pages[i], url: p.url })),
    title,
    truncated: list.length < total,
  };
}
