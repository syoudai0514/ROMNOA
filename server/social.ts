import { getCache } from "@vercel/functions";
import { parseDocument, DomUtils } from "htmlparser2";
import { z } from "zod";
import { fetchPublicPhoto } from "./public-photo-fetch.js";
import {
  socialPostUrl,
  socialPostSchema,
  type SocialPost,
} from "../src/lib/social-model.js";

const LIMIT = 1_500_000;
const clean = (s: unknown, limit = 2000) =>
  typeof s === "string"
    ? s
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .replace(/[ \t]+/g, " ")
        .trim()
        .slice(0, limit)
    : "";

async function read(url: string, accept: string, fetcher: typeof fetch) {
  const res = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: accept,
      "Accept-Language": "ja,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; ROMNOA/0.1; +https://github.com/syoudai0514/ROMNOA)",
    },
  });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw Error("post_unavailable");
  }
  const reader = res.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMIT) throw Error("post_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

const xPhoto = (raw: unknown) => {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" &&
      u.hostname === "pbs.twimg.com" &&
      /^\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/[\w./-]{1,200}\.(?:jpe?g|png|webp)$/.test(
        u.pathname,
      )
      ? u.href
      : null;
  } catch {
    return null;
  }
};
const xVideo = (raw: unknown) => {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" &&
      u.hostname === "video.twimg.com" &&
      /^\/[\w./-]{1,300}\.mp4$/.test(u.pathname) &&
      [...u.searchParams.keys()].every((k) => k === "tag")
      ? u.href
      : null;
  } catch {
    return null;
  }
};
const igMedia = (raw: unknown, video: boolean) => {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" &&
      u.hostname.endsWith(".cdninstagram.com") &&
      !u.port &&
      !u.username &&
      (video
        ? /\.mp4$/i.test(u.pathname)
        : /\.(?:jpe?g|png|webp|heic)$/i.test(u.pathname))
      ? u.href
      : null;
  } catch {
    return null;
  }
};

// The public JSON that X's own embed widget reads. No login is involved.
export function xToken(id: string) {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(6 ** 2)
    .replace(/(0+|\.)/g, "");
}
export function parseXPost(json: string, url: string): SocialPost {
  const data = JSON.parse(json);
  if (data?.__typename !== "Tweet" && !data?.id_str)
    throw Error("post_unavailable");
  const id = url.split("/").pop();
  if (String(data.id_str) !== id) throw Error("post_mismatch");
  const media = (Array.isArray(data.mediaDetails) ? data.mediaDetails : [])
    .slice(0, 10)
    .flatMap((m: any) => {
      const poster = xPhoto(m?.media_url_https);
      if (m?.type === "photo")
        return poster ? [{ type: "photo" as const, url: poster }] : [];
      const variants = (m?.video_info?.variants || [])
        .filter((v: any) => v?.content_type === "video/mp4" && xVideo(v.url))
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
      if (!variants.length)
        return poster ? [{ type: "photo", url: poster }] : [];
      return [
        {
          type:
            m.type === "animated_gif" ? ("gif" as const) : ("video" as const),
          url: xVideo(variants[0].url)!,
          poster: poster || undefined,
        },
      ];
    });
  return socialPostSchema.parse({
    provider: "X",
    url,
    author: clean(data.user?.name, 100),
    handle: clean(data.user?.screen_name, 30),
    // Remove t.co links that point at the media or the post itself.
    text: clean(data.text, 1200).replace(/\s*https:\/\/t\.co\/\w+/g, ""),
    createdAt:
      typeof data.created_at === "string" &&
      !Number.isNaN(Date.parse(data.created_at))
        ? new Date(data.created_at).toISOString()
        : undefined,
    media,
  });
}

// Instagram's public embed page. Prefer its declared media data (all carousel
// items and videos), and fall back to the single image it renders.
export function parseInstagramEmbed(html: string, url: string): SocialPost {
  const doc = parseDocument(html, { decodeEntities: true });
  const media: SocialPost["media"] = [];
  const context = html.match(/"contextJSON"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (context) {
    try {
      const data = JSON.parse(JSON.parse(context[1]));
      const root =
        data?.gql_data?.shortcode_media || data?.context?.media || data?.media;
      const nodes: any[] = root?.edge_sidecar_to_children?.edges?.length
        ? root.edge_sidecar_to_children.edges.map((e: any) => e?.node)
        : [root];
      for (const n of nodes.slice(0, 10)) {
        const poster = igMedia(n?.display_url, false);
        const video = n?.is_video ? igMedia(n?.video_url, true) : null;
        if (video)
          media.push({
            type: "video",
            url: video,
            poster: poster || undefined,
          });
        else if (poster) media.push({ type: "photo", url: poster });
      }
    } catch {
      /* use the rendered image */
    }
  }
  if (!media.length) {
    const img = DomUtils.findOne(
      (n) =>
        n.name === "img" &&
        /(?:^|\s)EmbeddedMediaImage(?:\s|$)/.test(n.attribs.class || ""),
      doc.children,
    );
    const best = [...(img?.attribs.srcset || "").matchAll(/(\S+)\s+(\d+)w/g)]
      .sort((a, b) => Number(b[2]) - Number(a[2]))
      .map((m) => igMedia(m[1], false))
      .find(Boolean);
    const src = best || igMedia(img?.attribs.src, false);
    if (src) media.push({ type: "photo", url: src });
  }
  const text = (cls: string) => {
    const n = DomUtils.findOne(
      (x) => new RegExp(`(?:^|\\s)${cls}(?:\\s|$)`).test(x.attribs.class || ""),
      doc.children,
    );
    return n ? clean(DomUtils.textContent(n)) : "";
  };
  const handle = text("UsernameText") || text("Username");
  let caption = text("Caption");
  if (handle && caption.startsWith(handle))
    caption = caption.slice(handle.length).trim();
  if (!media.length) throw Error("post_unavailable");
  return socialPostSchema.parse({
    provider: "Instagram",
    url,
    author: handle.slice(0, 100),
    handle: handle.slice(0, 30),
    text: caption
      .replace(/\s*(?:View all \d+ comments|コメント\d+件をすべて表示)$/, "")
      .slice(0, 1200),
    media,
  });
}

export async function fetchSocialPost(
  url: string,
  fetcher: typeof fetch = fetchPublicPhoto,
): Promise<SocialPost> {
  const post = socialPostUrl(url);
  if (!post || post.url !== url) throw Error("invalid_post");
  if (post.provider === "X") {
    const id = url.split("/").pop()!;
    const json = await read(
      `https://cdn.syndication.twimg.com/tweet-result?${new URLSearchParams({ id, lang: "ja", token: xToken(id) })}`,
      "application/json",
      fetcher,
    );
    return parseXPost(json, url);
  }
  const html = await read(`${url}embed/captioned/`, "text/html", fetcher);
  return parseInstagramEmbed(html, url);
}

const entrySchema = z.object({
  post: socialPostSchema.nullable(),
  at: z.number(),
});
type Entry = z.infer<typeof entrySchema>;
function cacheAdapter() {
  const memory = new Map<string, Entry>();
  if (!process.env.VERCEL)
    return {
      get: async (k: string) => memory.get(k),
      set: async (k: string, e: Entry) => {
        memory.delete(k);
        memory.set(k, e);
        if (memory.size > 200) memory.delete(memory.keys().next().value!);
      },
    };
  const cache = getCache({ namespace: "romnoa-social-v1" });
  return {
    get: async (k: string) => {
      const p = entrySchema.safeParse(await cache.get(k));
      return p.success ? p.data : undefined;
    },
    set: async (k: string, e: Entry) =>
      cache.set(k, e, { ttl: 3600, name: "ROMNOA social post" }),
  };
}
export class SocialService {
  private pending = new Map<string, Promise<SocialPost>>();
  constructor(
    private cache = cacheAdapter(),
    private load = fetchSocialPost,
    private now = Date.now,
  ) {}
  async get(url: string) {
    const active = this.pending.get(url);
    if (active) return active;
    const work = (async () => {
      const old = await this.cache.get(url).catch(() => undefined);
      // Signed Instagram media URLs expire; keep successes for an hour only.
      if (
        old &&
        this.now() - old.at >= 0 &&
        this.now() - old.at < (old.post ? 3600000 : 300000)
      ) {
        if (old.post) return old.post;
        throw Error("post_unavailable");
      }
      let post: SocialPost | null = null;
      try {
        post = await this.load(url);
      } finally {
        await this.cache
          .set(url, { post, at: this.now() })
          .catch(() => undefined);
      }
      return post;
    })();
    this.pending.set(url, work);
    try {
      return await work;
    } finally {
      this.pending.delete(url);
    }
  }
}
export const socialService = new SocialService();
export async function handleSocial(
  request: Request,
  engine: Pick<SocialService, "get"> = socialService,
  enabled = true,
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const p = new URL(request.url).searchParams,
    url = p.get("url") || "";
  if (
    socialPostUrl(url)?.url !== url ||
    [...p.keys()].some((k) => k !== "url" || p.getAll(k).length !== 1)
  )
    return Response.json(
      { error: "対応していない投稿です。" },
      { status: 400, headers },
    );
  if (!enabled)
    return Response.json(
      { error: "この機能は現在利用できません。" },
      { status: 403, headers },
    );
  try {
    return Response.json(await engine.get(url), { headers });
  } catch {
    return Response.json(
      { error: "投稿を表示できませんでした。" },
      { status: 502, headers },
    );
  }
}
