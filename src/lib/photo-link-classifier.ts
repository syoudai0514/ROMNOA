// Decide, from the URL and link text alone, whether a link in a Yahoo article
// body is worth opening as a photo gallery. Fetching and parsing every linked
// page (social posts, shops, unrelated stories) is what made the gallery
// target unpredictable; non-photo links never become photo features.
export type PhotoLinkKind =
  | "gallery" // a known publisher gallery format
  | "photo" // the link text or path says it leads to photos
  | "article" // an ordinary page without photo evidence
  | "social" // X / Instagram / TikTok etc. (handled by the reader, not here)
  | "ignore"; // shops, apps, tickets, top pages, files, Yahoo itself

const social =
  /(?:^|\.)(?:x\.com|twitter\.com|instagram\.com|threads\.(?:net|com)|tiktok\.com|facebook\.com|youtube\.com|youtu\.be|nicovideo\.jp|line\.me|bsky\.app)$/;
const ignored =
  /(?:^|\.)(?:yahoo\.co\.jp|yahoo\.jp|amazon\.co\.jp|amazon\.com|amzn\.to|amzn\.asia|rakuten\.co\.jp|r10\.to|apple\.com|google\.com|eplus\.jp|pia\.jp|l-tike\.com|bit\.ly|t\.co|lin\.ee|forms\.gle)$/;
// Known gallery formats. Each is shared by several publishers on the same CMS.
const galleries: RegExp[] = [
  /^\/article\/\d{8}dog\d{2}m\d{9}[a-z]\/photopage\/\d{3}\.html$/, // MANTAN
  /^\/photo\/detail\/\d+$/, // modelpress
  /^\/articles\/photo\/\d+$/, // ARENA CMS (bunshun, toyokeizai, president...)
  /^\/article\/img\/\d{4}\/\d{2}\/\d{2}\/\d+\/(?:\d+\.html)?$/, // IID CMS
  /^\/gallery\/news\/\d+\/(?:\d+\/?)?$/, // crank-in / natalie style
  /^\/news\/detail\/\d+\/\d+\/$/, // WEB The Television
];
const photoPath =
  /\/(?:photos?|gallery|galleries|images?|imgs?|gazo|picture|pictures|photopage|slideshow)(?:\/|\.html|$)|[?&](?:p|pn|photo|img|image)=\d/i;
const photoLabel =
  /写真|画像|フォト|グラビア|ギャラリー|ショット|カット集|オフショット|全\s*\d+\s*枚|\d+\s*枚|photo|gallery/i;
const nonPhotoLabel = /^【?(?:関連記事|関連|続きを読む|ランキング|PR)】?/;

export function classifyPhotoLink(
  url: string,
  label = "",
): { kind: PhotoLinkKind; score: number } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "ignore", score: 0 };
  }
  const host = u.hostname.toLowerCase();
  if (social.test(host)) return { kind: "social", score: 0 };
  if (
    ignored.test(host) ||
    /\.(?:pdf|zip|mp3|mp4|m3u8)$/i.test(u.pathname) ||
    (u.pathname === "/" && !u.search)
  )
    return { kind: "ignore", score: 0 };
  let score = 0;
  if (galleries.some((p) => p.test(u.pathname))) score += 5;
  if (photoPath.test(`${u.pathname}${u.search}`)) score += 2;
  if (photoLabel.test(label)) score += 3;
  if (nonPhotoLabel.test(label.trim()) && !photoLabel.test(label)) score -= 3;
  if (score >= 5 && galleries.some((p) => p.test(u.pathname)))
    return { kind: "gallery", score };
  return score > 0 ? { kind: "photo", score } : { kind: "article", score };
}

// Stable ordering: photo evidence first, the article's own order otherwise.
export function rankPhotoLinks<T extends { url: string; title: string }>(
  links: T[],
) {
  return links
    .map((link, i) => ({ link, i, ...classifyPhotoLink(link.url, link.title) }))
    .filter((l) => l.kind === "gallery" || l.kind === "photo")
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((l) => l.link);
}
