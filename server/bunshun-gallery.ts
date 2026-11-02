import { parseDocument, DomUtils } from "htmlparser2";
import { fetchPublicPhoto } from "./public-photo-fetch.js";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
import { photoIdentity } from "./photo-source.js";

// The publisher declares the gallery and supplies the full image for each
// numbered slide in its own photo endpoint. Check each image against the
// thumbnail roster before returning it. Other publishers on the same CMS
// (ARENA: /articles/photo/<id>?pn=<n>) are recognised by the same carousel
// markup rather than by hostname, and fall through to the generic parser if
// the markup is absent.
export async function bunshunGallery(
  html: string,
  pageUrl: string,
  fetcher: typeof fetch = fetchPublicPhoto,
) {
  const u = new URL(pageUrl),
    match = u.pathname.match(/^\/articles\/photo\/(\d+)$/);
  if (!match) return null;
  const doc = parseDocument(html),
    carousel = DomUtils.findOne(
      (n) => n.attribs.id === "photo-main-carousel",
      doc.children,
    );
  if (!carousel && u.hostname !== "bunshun.jp") return null;
  const thumbnail = DomUtils.findOne(
    (n) => n.attribs.id === "photo-thumbnail",
    doc.children,
  );
  const count = Number(carousel?.attribs["data-length"]),
    current = Number(u.searchParams.get("pn") || 1);
  if (
    !carousel ||
    carousel.attribs["data-publish-id"] !== match[1] ||
    !thumbnail ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 40 ||
    !Number.isInteger(current) ||
    current < 1 ||
    current > count
  )
    throw Error("gallery_structure_changed");
  const thumbs = DomUtils.findAll(
    (n) => n.name === "img",
    thumbnail.children,
  ).map((n) => publicPhotoUrl(n.attribs.src || "", pageUrl));
  if (thumbs.length !== count || thumbs.some((x) => !x))
    throw Error("gallery_structure_changed");
  let pictures: { url: string; alt: string; caption: string }[];
  try {
    pictures = await Promise.all(
    thumbs.map(async (thumb, i) => {
      const endpoint = `${u.origin}/articles/api-photo/${match[1]}?pn=${i + 1}`;
      const response = await fetcher(endpoint, {
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json" },
      });
      if (
        !response.ok ||
        !response.body ||
        !/(?:application\/json|text\/html)/i.test(
          response.headers.get("content-type") || "",
        )
      ) {
        await response.body?.cancel();
        throw Error("photo_source_unavailable");
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 32000) throw Error("photo_too_large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const src = typeof data.src === "string" && publicPhotoUrl(data.src);
      if (
        !src ||
        new URL(src).hostname !== new URL(thumb!).hostname ||
        new URL(src).pathname.split("/").pop() !==
          new URL(thumb!).pathname.split("/").pop()
      )
        throw Error("photo_mismatch");
      const caption =
        typeof data.caption === "string"
          ? DomUtils.textContent(parseDocument(data.caption))
              .trim()
              .slice(0, 500)
          : "";
      return { url: src, alt: caption, caption };
    }),
    );
  } catch (e) {
    // The photo API may refuse requests (406). The page itself declares the
    // shown photo's large rendition as og:image. When that image is the same
    // photograph as the current thumbnail (same mwimgs path; the og host may
    // be the site itself rather than its CDN), use the
    // same rendition folder for every thumbnail of this gallery.
    const og = DomUtils.findOne(
      (n) => n.name === "meta" && (n.attribs.property || n.attribs.name) === "og:image",
      doc.children,
    );
    const ogUrl = og && publicPhotoUrl(og.attribs.content || "", pageUrl);
    const current_thumb = thumbs[current - 1]!;
    const folder = ogUrl?.match(/\/mwimgs\/[^/]+\/[^/]+\/(\d{2,4}(?:wm|hm|w|h|m))\//)?.[1];
    const rendition = (thumb: string) => {
      const t = new URL(thumb);
      const m = t.pathname.match(/^(\/mwimgs\/[^/]+\/[^/]+\/)\d{2,4}(?:wm|hm|w|h|m)(\/[^/]+)$/);
      return m && folder ? `${t.origin}${m[1]}${folder}${m[2]}` : null;
    };
    const upgraded = thumbs.map((t) => rendition(t!));
    // Only an unavailable API falls back; a mismatching answer stays an error.
    if (
      !(e instanceof Error && e.message === "photo_source_unavailable") ||
      !ogUrl ||
      !folder ||
      photoIdentity(ogUrl)?.replace(/^https:\/\/[^/]+/, "") !==
        photoIdentity(current_thumb)?.replace(/^https:\/\/[^/]+/, "") ||
      upgraded.some((u) => !u || !publicPhotoUrl(u))
    )
      throw e;
    pictures = upgraded.map((url, i) => {
      const img = DomUtils.findAll((n) => n.name === "img", thumbnail.children)[i];
      const alt = (img?.attribs.alt || "").trim().slice(0, 500);
      return { url: url!, alt, caption: alt };
    });
  }
  const pages = pictures.map((_, i) =>
    i === current - 1
      ? pageUrl
      : `${pageUrl}#romnoa-photo-${i < current - 1 ? i + 2 : i + 1}`,
  );
  return {
    kind: "gallery" as const,
    picture: pictures[current - 1],
    pictures,
    pages,
    thumbnails: thumbs.map((url, i) => ({ pageUrl: pages[i], url: url! })),
    title: "",
  };
}
