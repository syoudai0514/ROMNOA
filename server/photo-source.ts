import type { Element } from "domhandler";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";

// Preserve origin and content folders. Only known presentation transforms are
// removed; equal basenames in different articles are not the same photograph.
export function photoIdentity(raw: string): string | null {
  try {
    const u = new URL(raw);
    let path = decodeURIComponent(u.pathname)
      // IID CMS uses a transformation token for the thumbnail and /zoom/
      // for the original, retaining the same numeric media ID.
      .replace(/^\/imgs\/p\/[^/]+\/(\d+)\./, "/imgs/zoom/$1.")
      .replace(/\/(?:w=\d+,[^/]+)\//g, "/")
      .replace(/\.(?:jpe?g|png|webp|avif|gif)$/i, "");
    // ismcdn (mwimgs) puts the rendition in a folder: 870m, 1420wm, 680w,
    // 1360w, 64h, or "-" for the original. All name the same photograph.
    if (path.includes("/mwimgs/"))
      path = path.replace(/\/(?:\d{2,4}(?:wm|hm|w|h|m)|-)\//g, "/");
    // Renditions named by a prefix inside a numeric media folder
    // (/uploads/image/1951360/middle_X.jpg, large_X, small_X, sns_X), and a
    // "_b" (big) suffix on a long numeric media ID (keizai.biz 1793707097_b).
    path = path
      .replace(/\/(\d{4,})\/(?:thumb|small|middle|medium|large|sns)_/i, "/$1/")
      .replace(/\/(\d{8,})_b$/i, "/$1");
    for (let i = 0; i < 3; i++)
      path = path.replace(/(?:[-_.@](?:\d{2,4}x\d{2,4}|\d{2,4}x|w\d{2,4}|h\d{2,4}|\d{2,4}px|thumb|thumbnail|thumbs|small|medium|large|sq|square|crop|x2|2x|[sml]|o|org|orig))+$/i, "");
    const query = [...u.searchParams]
      .filter(([k]) => !/^(?:w|h|width|height|fit|crop|quality|q|format|fm|auto|dpr|imwidth|imheight|imdensity|impolicy|resize)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    return `${u.origin}${path}?${new URLSearchParams(query)}`;
  } catch { return null; }
}

// Compare quality only within a verified photograph. A lazy source identifies
// the image; srcset supplies its larger variants without substituting a card.
export function photoSource(img: Element, base: string): string | null {
  const a = img.attribs;
  const valid = (raw: string | undefined) => {
    if (!raw || raw.startsWith("data:")) return null;
    const u = publicPhotoUrl(raw.trim(), base);
    return u && !/\.(?:svg|ico)(?:[?#]|$)/i.test(u) ? u : null;
  };
  const sets = [...(a["data-srcset"] || a.srcset || "").matchAll(/(\S+?)\s+(\d+(?:\.\d+)?)([wx])(?:,|$)/g)]
    .map(m => ({ url: valid(m[1]), size: Number(m[2]) * (m[3] === "x" ? 1000 : 1) }));
  // Lazy-load placeholders (1x1 GIFs) are never photographs. A GIF in src
  // counts only when nothing else names the image.
  const lazySets = [...(a["data-lazy-srcset"] || "").matchAll(/(\S+?)\s+(\d+(?:\.\d+)?)([wx])(?:,|$)/g)]
    .map(m => ({ url: valid(m[1]), size: Number(m[2]) * (m[3] === "x" ? 1000 : 1) }));
  sets.push(...lazySets);
  const lazyCandidates = [a["data-src"], a["data-original"], a["data-lazy-src"], a["data-lazy"]].map(valid);
  const lazy = lazyCandidates.find(Boolean);
  const named = !!lazy || sets.some(s => s.url);
  const plain = valid(a.src);
  const src = plain && named && /\.gif(?:[?#]|$)/i.test(plain) ? null : plain;
  const anchor = lazy || sets.find(s => s.url)?.url || src;
  if (!anchor) return null;
  const identity = photoIdentity(anchor);
  const size = (url: string) => {
    const u = new URL(url);
    return Number(u.searchParams.get("w") || u.searchParams.get("width") || u.searchParams.get("imwidth")) ||
      Number(u.pathname.match(/[-_](\d{2,4})x\d{2,4}\./)?.[1]) ||
      Number(u.pathname.match(/\/(\d{2,4})w?m\//)?.[1]) || 0;
  };
  return [{ url: anchor, size: size(anchor) }, ...sets,
    ...lazyCandidates.map(url => ({ url, size: url ? size(url) : 0 })),
    { url: src, size: src ? size(src) : 0 }]
    .filter((c): c is { url: string; size: number } => !!c.url && photoIdentity(c.url) === identity)
    .sort((x, y) => y.size - x.size)[0].url;
}

// The size a URL declares for its rendition: ?w=/width=/imwidth=, WordPress
// -300x200, ismcdn 870m / 1200wm / 64h. A height alone (?h=, 64h, 400hm) is
// not the long side of the photo, so it is reported separately.
function declared(raw: string): { size: number; heightOnly: boolean } {
  try {
    const u = new URL(raw);
    const q = (keys: string[]) => Math.max(...keys.map((k) => Number(u.searchParams.get(k)) || 0));
    const w = q(["w", "width", "imwidth"]), h = q(["h", "height", "imheight"]);
    if (w || h) return { size: Math.max(w, h), heightOnly: !w };
    const wp = u.pathname.match(/[-_](\d{2,4})x(\d{2,4})\.(?:jpe?g|png|webp|avif|gif)$/i);
    if (wp) return { size: Math.max(Number(wp[1]), Number(wp[2])), heightOnly: false };
    const mw = u.pathname.includes("/mwimgs/") && u.pathname.match(/\/(\d{2,4})(wm|hm|w|h|m)\//);
    if (mw) return { size: Number(mw[1]), heightOnly: mw[2] === "h" || mw[2] === "hm" };
  } catch {
    /* not a URL */
  }
  return { size: 0, heightOnly: false };
}
// The longest side a URL declares, or 0 when it does not say.
export function declaredSize(raw: string): number {
  return declared(raw).size;
}
// A photograph declared smaller than this is a navigation thumbnail.
export const MIN_PHOTO_SIZE = 240;
// A height-only rendition below this is a thumbnail strip (64h); taller
// height-only renditions say nothing certain about the long side.
const MIN_PHOTO_HEIGHT = 120;
// true: declared tiny; false: declared large enough; null: size unknown.
export function thumbnailEvidence(raw: string): boolean | null {
  const d = declared(raw);
  if (!d.size) return null;
  if (d.heightOnly) return d.size < MIN_PHOTO_HEIGHT ? true : null;
  return d.size < MIN_PHOTO_SIZE;
}
export function looksLikeThumbnail(raw: string) {
  return thumbnailEvidence(raw) === true;
}
// Pictures an adapter shows are navigation thumbnails when the current one
// is declared tiny, or when at least half of them are. Unknown sizes are
// unknown: they neither prove nor disprove a list of thumbnails.
export function thumbnailGallery(current: string, shown: string[]) {
  const evidence = shown.map(thumbnailEvidence);
  const tiny = evidence.filter((e) => e === true).length;
  const large = evidence.filter((e) => e === false).length;
  if (looksLikeThumbnail(current) && tiny >= large) return true;
  return tiny > 0 && tiny * 2 >= shown.length;
}

// How large a rendition's name says it is, for choosing between URLs of the
// same photograph: a declared size first, then the rendition's name.
function renditionRank(raw: string, peers: string[]): number {
  const d = declared(raw);
  if (d.size && !d.heightOnly) return d.size;
  const path = new URL(raw).pathname;
  if (/\/(?:thumb|small)_[^/]+$/i.test(path)) return 2;
  if (/\/(?:middle|medium)_[^/]+$/i.test(path)) return 3;
  // A social-card rendition (sns_) may be cropped; never prefer it.
  if (/\/sns_[^/]+$/i.test(path)) return 1;
  if (/\/large_[^/]+$/i.test(path) || /\/\d{8,}_b\.[a-z]+$/i.test(path)) return 5000;
  // An unsized name beside sized renditions of the same photo is the
  // original upload (WordPress foo.jpg beside foo-345x230.jpg; ismcdn "-").
  if (d.heightOnly) return d.size;
  if (peers.some((p) => p !== raw && declared(p).size > 0 && !declared(p).heightOnly) ||
      /\/mwimgs\/[^/]+\/[^/]+\/-\//.test(path))
    return 4000;
  return 4;
}

// Every image URL the page itself names (img, source, srcset, lazy
// attributes, og:image, links to image files), grouped by photograph.
export function pageImageUrls(html: string, pageUrl: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (raw: string) => {
    const url = publicPhotoUrl(raw.trim().replace(/&amp;/g, "&"), pageUrl);
    if (!url || !/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url)) return;
    const id = photoIdentity(url);
    if (!id) return;
    const list = found.get(id) ?? [];
    if (!list.includes(url)) list.push(url);
    found.set(id, list);
  };
  for (const m of html.matchAll(/\s(?:src|href|content|srcset|srcSet|data-[\w-]+)\s*=\s*"([^"<>]{1,2000})"/g)) {
    const value = m[1];
    if (/,\s*\S+\s+\d+(?:\.\d+)?[wx]|^\S+\s+\d+(?:\.\d+)?[wx]/.test(value))
      for (const part of value.split(/,\s*/)) add(part.trim().split(/\s+/)[0] || "");
    else add(value);
  }
  return found;
}

// Replace a photo with the largest rendition of the same photograph that the
// page itself links. Nothing is guessed: every replacement is a URL the
// publisher put in this page.
export function largestOnPage(url: string, urls: Map<string, string[]>): string {
  const id = photoIdentity(url);
  const peers = id ? urls.get(id) : undefined;
  if (!peers?.length) return url;
  const all = peers.includes(url) ? peers : [url, ...peers];
  return all.reduce((best, u) => (renditionRank(u, all) > renditionRank(best, all) ? u : best), url);
}
