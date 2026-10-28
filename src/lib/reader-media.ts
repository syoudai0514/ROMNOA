import type { ReaderDocument } from "./reader-model.js";

function target(raw: string) {
  try {
    if (raw.length > 2048) return null;
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.port || u.username || u.password)
      return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

function instagramCdn(u: URL) {
  return (
    u.hostname.endsWith(".cdninstagram.com") &&
    !u.pathname.includes("t51.2885-19") &&
    ![...u.searchParams.keys()].some((key) =>
      /^(?:url|redirect|next|callback)$/i.test(key),
    )
  );
}

export function instagramImageUrl(raw: string): string | null {
  const u = target(raw);
  return u && instagramCdn(u) && /\.(?:jpe?g|png|gif|webp)$/i.test(u.pathname)
    ? u.href
    : null;
}

export function readerVideoUrl(raw: string, sourceId: string): string | null {
  if (sourceId !== "hamusoku" && sourceId !== "alfalfa") return null;
  const u = target(raw);
  if (!u) return null;
  if (
    u.hostname === "video.twimg.com" &&
    (/^\/(?:amplify_video|ext_tw_video)\/[1-9]\d{5,24}\/(?:pu\/)?vid\/(?:avc1\/)?\d{2,5}x\d{2,5}\/[A-Za-z0-9_-]{1,200}\.mp4$/.test(
      u.pathname,
    ) ||
      /^\/tweet_video\/[A-Za-z0-9_-]{1,200}\.mp4$/.test(u.pathname)) &&
    [...u.searchParams.keys()].every(
      (key) =>
        key === "tag" &&
        u.searchParams.getAll(key).length === 1 &&
        /^\d{1,3}$/.test(u.searchParams.get(key)!),
    )
  )
    return u.href;
  if (
    ["imgur.com", "www.imgur.com", "i.imgur.com"].includes(u.hostname) &&
    !u.search &&
    /^\/[A-Za-z0-9]{5,12}\.(?:mp4|gifv)$/i.test(u.pathname)
  ) {
    u.hostname = "i.imgur.com";
    u.pathname = u.pathname.replace(/\.gifv$/i, ".mp4");
    return u.href;
  }
  const folder = sourceId === "hamusoku" ? "hamusoku" : "amosaic";
  if (
    u.hostname === "livedoor.blogimg.jp" &&
    !u.search &&
    u.pathname.startsWith(`/${folder}/imgs/`) &&
    /\.mp4$/i.test(u.pathname)
  )
    return u.href;
  if (instagramCdn(u) && /\.mp4$/i.test(u.pathname)) return u.href;
  return null;
}

export type ReaderVideo = { url: string; animated: boolean };
export function readerVideos(document: ReaderDocument): ReaderVideo[] {
  const videos = new Map<string, ReaderVideo>();
  for (const link of document.links) {
    const url = readerVideoUrl(link.url, document.sourceId);
    if (!url || videos.size >= 8) continue;
    const animated = /\/tweet_video\/|\.gifv(?:#|$)/i.test(link.url);
    videos.set(url, {
      url,
      animated: animated || videos.get(url)?.animated || false,
    });
  }
  return [...videos.values()];
}

export function socialPostUrl(
  raw: string,
): { provider: "X" | "Instagram"; url: string } | null {
  const u = target(raw);
  if (!u) return null;
  if (
    [
      "x.com",
      "www.x.com",
      "twitter.com",
      "www.twitter.com",
      "mobile.twitter.com",
    ].includes(u.hostname)
  ) {
    const m = u.pathname.match(
      /^\/(?:([A-Za-z0-9_]{1,15})\/status|i\/(?:web\/)?status)\/([1-9]\d{5,24})(?:\/(?:photo|video)\/\d+)?\/?$/,
    );
    if (m)
      return {
        provider: "X",
        url: `https://x.com/${m[1] || "i"}/status/${m[2]}`,
      };
  }
  if (["instagram.com", "www.instagram.com"].includes(u.hostname)) {
    const m = u.pathname.match(
      /^\/(p|reel|tv)\/([A-Za-z0-9_-]{5,100})(?:\/embed)?\/?$/,
    );
    if (m)
      return {
        provider: "Instagram",
        url: `https://www.instagram.com/${m[1]}/${m[2]}/`,
      };
  }
  return null;
}

export function readerSocialPosts(document: ReaderDocument) {
  const posts = new Map<
    string,
    NonNullable<ReturnType<typeof socialPostUrl>>
  >();
  for (const link of document.links) {
    const post = socialPostUrl(link.url);
    if (post && posts.size < 12) posts.set(post.url, post);
  }
  return [...posts.values()];
}
