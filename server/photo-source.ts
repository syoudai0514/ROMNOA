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
