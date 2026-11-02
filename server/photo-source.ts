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
    if (path.includes("/mwimgs/")) path = path.replace(/\/\d{2,4}m\//g, "/");
    for (let i = 0; i < 3; i++)
      path = path.replace(/(?:[-_.@](?:\d{2,4}x\d{2,4}|\d{2,4}x|w\d{2,4}|h\d{2,4}|\d{2,4}px|thumb|thumbnail|thumbs|small|medium|large|sq|square|crop|x2|2x|[sml]|o|org|orig))+$/i, "");
    const query = [...u.searchParams]
      .filter(([k]) => !/^(?:w|h|width|height|fit|crop|quality|q|format|fm|auto|dpr|impolicy|resize)$/i.test(k))
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
  const lazyCandidates = [a["data-src"], a["data-original"], a["data-lazy-src"], a["data-lazy"]].map(valid);
  const lazy = lazyCandidates.find(Boolean);
  const anchor = lazy || sets.find(s => s.url)?.url || valid(a.src);
  if (!anchor) return null;
  const identity = photoIdentity(anchor);
  const size = (url: string) => {
    const u = new URL(url);
    return Number(u.searchParams.get("w") || u.searchParams.get("width")) ||
      Number(u.pathname.match(/[-_](\d{2,4})x\d{2,4}\./)?.[1]) ||
      Number(u.pathname.match(/\/(\d{2,4})m\//)?.[1]) || 0;
  };
  const src = valid(a.src);
  return [{ url: anchor, size: size(anchor) }, ...sets,
    ...lazyCandidates.map(url => ({ url, size: url ? size(url) : 0 })),
    { url: src, size: src ? size(src) : 0 }]
    .filter((c): c is { url: string; size: number } => !!c.url && photoIdentity(c.url) === identity)
    .sort((x, y) => y.size - x.size)[0].url;
}
