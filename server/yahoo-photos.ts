import { declaredGallery } from "./declared-gallery.js";
import { oriconGallery } from "./oricon-gallery.js";
import { entameGallery, entamePhotoKey } from "./entame-gallery.js";
import { mdprGallery } from "./mdpr-gallery.js";
import { bunshunGallery } from "./bunshun-gallery.js";
import { collectLinkedPhotos } from "./linked-photo-parser.js";
import { fetchPublicPhoto } from "./public-photo-fetch.js";
import { getCache } from "@vercel/functions";
import { Parser } from "htmlparser2";
import { z } from "zod";
import { yahooArticleUrl, yahooImageUrl } from "../src/lib/yahoo-model.js";
import { rankPhotoLinks } from "../src/lib/photo-link-classifier.js";
import {
  photoFeatureTarget,
  linkedPhotoTarget,
  linkedImageUrl,
  mantanPhotoUrl,
  yahooPictureSchema,
  photoFeatureSchema,
  photoThumbnailSchema,
  yahooPhotoMetadataSchema,
  yahooPhotoGallerySchema,
  type YahooPhotoMetadata,
  type YahooPhotoGallery,
  type YahooPicture,
  type PhotoFeature,
} from "../src/lib/yahoo-photos-model.js";

const MAX_BYTES = 2_000_000,
  HOUR = 3_600_000,
  DAY = 86_400_000;
function clean(s: unknown, limit = 500) {
  return typeof s === "string"
    ? s
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}
const object = (s: unknown): Record<string, unknown> =>
  s && typeof s === "object" && !Array.isArray(s)
    ? (s as Record<string, unknown>)
    : {};
const array = (s: unknown) => (Array.isArray(s) ? s : []);
const articleDataSchema = z.object({
  kind: z.literal("article"),
  pictures: z.array(yahooPictureSchema).max(40),
  features: z.array(photoFeatureSchema).max(12),
});
const galleryDataSchema = z.object({
  kind: z.literal("gallery"),
  picture: yahooPictureSchema,
  pictures: z.array(yahooPictureSchema).max(40).optional(),
  pages: z.array(photoFeatureSchema.shape.url).min(1).max(80),
  thumbnails: z.array(photoThumbnailSchema).max(80).default([]),
  title: z.string().max(500),
});
const dataSchema = z.discriminatedUnion("kind", [
  articleDataSchema,
  galleryDataSchema,
]);
type PhotoData = z.infer<typeof dataSchema>;

export function parseYahooPhotoMetadata(
  html: string,
  articleId: string,
): z.infer<typeof articleDataSchema> {
  if (!yahooArticleUrl(articleId) || Buffer.byteLength(html) > MAX_BYTES)
    throw Error("invalid_article");
  const states: unknown[] = [];
  let script = "",
    active = false;
  new Parser(
    {
      onopentag(n) {
        if (n === "script") {
          active = true;
          script = "";
        }
      },
      ontext(s) {
        if (active) script += s;
      },
      onclosetag(n) {
        if (n !== "script" || !active) return;
        active = false;
        const match = script.match(
          /^\s*window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
        );
        if (match) {
          try {
            states.push(JSON.parse(match[1]));
          } catch {
            /* fail below */
          }
        }
      },
    },
    { decodeEntities: false },
  ).end(html);
  if (states.length !== 1) throw Error("article_structure_changed");
  const detail = object(object(states[0]).articleDetail);
  if (
    detail.contentId !== new URL(articleId).pathname.slice(10) ||
    detail.newsLink !== articleId
  )
    throw Error("article_mismatch");
  const pictures: YahooPicture[] = [];
  for (const raw of array(detail.richObjectItems).slice(0, 40)) {
    const item = object(raw);
    const url = [
      object(item.view).uri,
      object(item.resizedViewUrl).jpeg,
      object(item.thumb).uri,
    ]
      .filter((s): s is string => typeof s === "string")
      .map(yahooImageUrl)
      .find(Boolean);
    if (url)
      pictures.push({
        url,
        alt: clean(item.alt) || clean(item.caption),
        caption: clean(item.caption),
        credit: clean(item.credit, 200),
      });
  }
  const inline: PhotoFeature[] = [],
    related: PhotoFeature[] = [];
  function add(title: unknown, raw: unknown, isInline = true) {
    if (typeof raw !== "string") return;
    const target = isInline ? linkedPhotoTarget(raw) : photoFeatureTarget(raw),
      label = clean(title),
      list = isInline ? inline : related;
    if (target && label && !list.some((f) => f.url === target.url))
      list.push({ title: label, url: target.url });
  }
  // New Yahoo rich-body trees may omit the legacy paragraph link fields.
  let visited = 0;
  function visit(raw: unknown, depth = 0): string {
    if (++visited > 10000 || depth > 80) return "";
    const node = object(raw);
    const text =
      clean(node.value) ||
      array(node.children)
        .map((c) => visit(c, depth + 1))
        .join("");
    if (node.tagName === "a") add(text, object(node.attributes).href);
    return text.slice(0, 500);
  }
  for (const node of array(detail.richBody)) visit(node);
  // The inline photo-feature link is the primary destination. Related links
  // follow it; ranking/ad widgets and arbitrary anchors are never traversed.
  for (const paragraph of array(detail.paragraphs).slice(0, 100)) {
    for (const text of array(object(paragraph).textDetails).slice(0, 100)) {
      const link = object(object(text).link);
      add(link.linkText, link.linkURL);
      for (const part of array(object(text).paragraphItems).slice(0, 100)) {
        const p = object(part),
          l = object(p.link);
        add(l.linkText || p.text, l.linkURL);
      }
    }
  }
  for (const raw of array(detail.relatedLink).slice(0, 20)) {
    const l = object(raw);
    add(l.title, l.uri, false);
  }
  // Only links with photo evidence become features; social posts, shops and
  // plain related stories are left to the article body.
  const features: PhotoFeature[] = [];
  for (const f of [...rankPhotoLinks(inline), ...related])
    if (!features.some((x) => x.url === f.url)) features.push(f);
  return articleDataSchema.parse({
    kind: "article",
    pictures,
    features: features.slice(0, 12),
  });
}

export function parseMantanPhotoPage(
  html: string,
  pageUrl: string,
): z.infer<typeof galleryDataSchema> {
  const target = photoFeatureTarget(pageUrl);
  if (!target || Buffer.byteLength(html) > MAX_BYTES)
    throw Error("invalid_gallery");
  const candidates: { url: string; score: number; alt: string }[] = [];
  const pages = new Set<string>();
  const thumbnails = new Map<string, string>();
  const context: { blocked: boolean; main: boolean }[] = [];
  let thumbnailPage: string | null = null;
  let title = "",
    inTitle = false,
    nodes = 0,
    depth = 0;
  new Parser(
    {
      onopentag(n, a) {
        if (++nodes > 60000 || ++depth > 160)
          throw Error("gallery_too_complex");
        const parent = context[context.length - 1];
        const blocked =
          !!parent?.blocked ||
          ["script", "style", "iframe", "aside", "nav", "footer"].includes(n) ||
          a.hidden !== undefined ||
          a["aria-hidden"] === "true" ||
          /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style || "") ||
          /(?:^|[-_\s])(?:ad|ads|advert|advertisement|sponsored|banner)(?:$|[-_\s])|recommend|related|ranking/i.test(
            `${a.class || ""} ${a.id || ""}`,
          );
        const main =
          !!parent?.main ||
          /(?:^|\s)photo__photo(?:--[^\s]+)?(?:\s|$)/.test(a.class || "");
        context.push({ blocked, main });
        if (n === "title") inTitle = true;
        if (blocked) return;
        if (
          n === "a" &&
          /(?:^|\s)photo__photolist-item(?:\s|$)/.test(a.class || "")
        ) {
          const linked = photoFeatureTarget(a.href || "", target.url);
          if (
            linked &&
            linked.family === target.family &&
            linked.host === target.host &&
            pages.size < 80
          ) {
            pages.add(linked.url);
            thumbnailPage = linked.url;
          }
        }
        if (n === "img" && thumbnailPage) {
          const url = mantanPhotoUrl(a.src || "", target.family);
          if (url) thumbnails.set(thumbnailPage, url);
        }
        if (
          n === "img" &&
          main &&
          /(?:^|\s)photo__image(?:\s|$)/.test(a.class || "")
        ) {
          const add = (raw: string, score: number) => {
            const url = mantanPhotoUrl(raw, target.family);
            if (url) candidates.push({ url, score, alt: clean(a.alt) });
          };
          add(a.src || "", 1);
          // Commas also occur inside the publisher's image-transform URLs.
          for (const m of (a.srcset || "").matchAll(
            /(https:\/\/storage\.mantan-web\.jp\/[^\s]+)\s+(\d+(?:\.\d+)?)(x|w)/g,
          ))
            add(m[1], Number(m[2]));
        }
      },
      ontext(s) {
        if (inTitle) title += s;
      },
      onclosetag(n) {
        context.pop();
        depth = Math.max(0, depth - 1);
        if (n === "title") inTitle = false;
        if (n === "a") thumbnailPage = null;
      },
    },
    { decodeEntities: true },
  ).end(html);
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || !pages.has(target.url))
    throw Error("gallery_structure_changed");
  const best = candidates[0];
  return galleryDataSchema.parse({
    kind: "gallery",
    picture: {
      url: best.url,
      alt: best.alt,
      caption: best.alt,
      credit: "MANTANWEB",
    },
    pages: [...pages].sort(),
    thumbnails: [...thumbnails].map(([pageUrl, url]) => ({ pageUrl, url })),
    title: clean(title),
  });
}

export async function fetchPhotoHtml(
  url: string,
  fetcher: typeof fetch = fetchPublicPhoto,
) {
  if (yahooArticleUrl(url) !== url && linkedPhotoTarget(url)?.url !== url)
    throw Error("target_not_allowed");
  const res = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: "text/html",
      "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
    },
  });
  if (
    !res.ok ||
    !res.body ||
    !/text\/html/i.test(res.headers.get("content-type") || "")
  ) {
    await res.body?.cancel();
    throw Error("photo_source_unavailable");
  }
  if (Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body.cancel();
    throw Error("page_too_large");
  }
  const reader = res.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BYTES) throw Error("page_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks);
  const declared =
    res.headers.get("content-type")?.match(/charset=["']?([\w-]+)/i)?.[1] ||
    buffer
      .subarray(0, 4096)
      .toString("ascii")
      .match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ||
    "utf-8";
  try {
    return new TextDecoder(declared).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}
const entrySchema = z.object({
  data: dataSchema.nullable(),
  fetchedAt: z.number(),
  checkedAt: z.number(),
  failed: z.boolean(),
});
type Entry = z.infer<typeof entrySchema>;
export interface PhotoCache {
  get(k: string): Promise<Entry | undefined>;
  set(k: string, e: Entry): Promise<void>;
}
export class MemoryPhotoCache implements PhotoCache {
  private data = new Map<string, Entry>();
  async get(k: string) {
    return this.data.get(k);
  }
  async set(k: string, e: Entry) {
    this.data.delete(k);
    this.data.set(k, e);
    if (this.data.size > 120) this.data.delete(this.data.keys().next().value!);
  }
}
function cacheAdapter(): PhotoCache {
  if (!process.env.VERCEL) return new MemoryPhotoCache();
  const cache = getCache({ namespace: "romnoa-yahoo-photos-v13" });
  return {
    async get(k) {
      const p = entrySchema.safeParse(await cache.get(k));
      return p.success ? p.data : undefined;
    },
    async set(k, e) {
      await cache.set(k, e, {
        ttl: 86400,
        name: "ROMNOA article photo metadata",
      });
    },
  };
}
export class PhotoAccessError extends Error {}
export class YahooPhotoService {
  private pending = new Map<string, Promise<Entry>>();
  constructor(
    private cache: PhotoCache,
    private load = fetchPhotoHtml,
    private now = Date.now,
  ) {}
  async imageSource(
    articleId: string,
    feature: string,
    page: string,
    thumbnail: boolean,
  ) {
    const meta = await this.get(articleId);
    if (
      meta.kind !== "article" ||
      !meta.features.some((f) => f.url === feature)
    )
      throw new PhotoAccessError("feature_not_linked");
    const first = await this.entry(feature),
      gallery = first.data!;
    if (gallery.kind !== "gallery" || !gallery.pages.includes(page))
      throw new PhotoAccessError("page_not_linked");
    let url: string | undefined;
    if (thumbnail)
      url = gallery.thumbnails.find((t) => t.pageUrl === page)?.url;
    else {
      const selected = await this.get(articleId, feature, page);
      if (selected.kind === "gallery") url = selected.picture.url;
    }
    if (
      !url ||
      !(photoFeatureTarget(feature)
        ? mantanPhotoUrl(url, photoFeatureTarget(feature)?.family)
        : linkedImageUrl(url))
    )
      throw Error("image_not_available");
    return {
      url,
      referer: (gallery.pictures?.length
        ? page
        : thumbnail
          ? feature
          : page
      ).split("#")[0],
    };
  }
  private async entry(url: string): Promise<Entry> {
    const pending = this.pending.get(url);
    if (pending) return pending;
    const work = (async () => {
      let old: Entry | undefined;
      try {
        const p = entrySchema.safeParse(await this.cache.get(url));
        if (p.success) old = p.data;
      } catch {
        /* source remains available */
      }
      const now = this.now(),
        usable =
          old?.data && now - old.fetchedAt >= 0 && now - old.fetchedAt < DAY;
      if (
        old &&
        now - old.checkedAt >= 0 &&
        now - old.checkedAt < (old.failed ? 60000 : HOUR)
      ) {
        if (usable) return old;
        throw Error("photo_source_unavailable");
      }
      let entry: Entry;
      try {
        const html = await this.load(url);
        const data = yahooArticleUrl(url)
          ? parseYahooPhotoMetadata(html, url)
          : photoFeatureTarget(url)
            ? parseMantanPhotoPage(html, url)
            : declaredGallery(html, url) ||
              oriconGallery(html, url) ||
              entameGallery(html, url) ||
              mdprGallery(html, url) ||
              (await bunshunGallery(html, url)) ||
              (await collectLinkedPhotos(html, url, this.load));
        entry = { data, fetchedAt: now, checkedAt: now, failed: false };
      } catch {
        entry = {
          data: usable && old ? old.data : null,
          fetchedAt: usable && old ? old.fetchedAt : 0,
          checkedAt: now,
          failed: true,
        };
      }
      try {
        await this.cache.set(url, entry);
      } catch {
        /* cache is optional */
      }
      if (!entry.data) throw Error("photo_source_unavailable");
      return entry;
    })();
    this.pending.set(url, work);
    try {
      return await work;
    } finally {
      this.pending.delete(url);
    }
  }
  async get(
    articleId: string,
    feature?: string,
    page?: string,
  ): Promise<YahooPhotoMetadata | YahooPhotoGallery> {
    if (yahooArticleUrl(articleId) !== articleId)
      throw new PhotoAccessError("invalid_article");
    if (
      (page && !feature) ||
      (feature && linkedPhotoTarget(feature)?.url !== feature) ||
      (page && linkedPhotoTarget(page)?.url !== page)
    )
      throw new PhotoAccessError("invalid_feature");
    const meta = await this.entry(articleId),
      data = meta.data!;
    if (data.kind !== "article") throw Error("wrong_cache_kind");
    if (!feature)
      return yahooPhotoMetadataSchema.parse({
        ...data,
        articleId,
        fetchedAt: new Date(meta.fetchedAt).toISOString(),
        status: meta.failed ? "cached" : "ok",
      });
    if (!data.features.some((f) => f.url === feature))
      throw new PhotoAccessError("feature_not_linked");
    const first = await this.entry(feature),
      gallery = first.data!;
    if (gallery.kind !== "gallery") throw Error("wrong_cache_kind");
    const label =
      data.features.find((f) => f.url === feature)?.title.normalize("NFKC") ||
      "";
    const expected = Number(
      label
        .match(/(?:写真|画像|全)\s*(\d+)\s*枚|(?:全)?\s*(\d+)\s*枚/)
        ?.slice(1)
        .find(Boolean) || 0,
    );
    if (expected > 1 && gallery.pages.length < expected)
      throw Error("incomplete_gallery");
    const selected = page || feature;
    if (!gallery.pages.includes(selected))
      throw new PhotoAccessError("page_not_linked");
    const current =
        selected === feature || gallery.pictures?.length
          ? first
          : await this.entry(selected),
      photo = current.data!;
    if (photo.kind !== "gallery") throw Error("wrong_cache_kind");
    if (/(^|\.)oricon\.co\.jp$/.test(new URL(feature).hostname)) {
      const paths = (g: typeof gallery) =>
        g.pages.map((p) => new URL(p).pathname).join("\n");
      if (paths(photo) !== paths(gallery))
        throw Error("gallery_structure_changed");
    }

    const entameArticle =
      new URL(feature).hostname === "entamenext.com" &&
      new URL(feature).pathname.match(/^\/articles\/gallery\/(\d+)\/\d+$/);
    if (entameArticle) {
      const keys = (g: typeof gallery) =>
        g.thumbnails.map((t) => entamePhotoKey(t.url, entameArticle[1]));
      const thumb = gallery.thumbnails.find((t) => t.pageUrl === selected);
      if (
        !thumb ||
        keys(gallery).some((key) => !key) ||
        keys(gallery).join("\n") !== keys(photo).join("\n") ||
        entamePhotoKey(thumb.url, entameArticle[1]) !==
          entamePhotoKey(photo.picture.url, entameArticle[1])
      )
        throw Error("gallery_structure_changed");
    }
    if (
      new URL(feature).hostname === "mdpr.jp" &&
      /^\/photo\/detail\/\d+$/.test(new URL(feature).pathname)
    ) {
      const thumb = gallery.thumbnails.find((t) => t.pageUrl === selected);
      if (
        !thumb ||
        photo.pages.join("\n") !== gallery.pages.join("\n") ||
        new URL(thumb.url).origin !== new URL(photo.picture.url).origin ||
        new URL(thumb.url).pathname !== new URL(photo.picture.url).pathname
      )
        throw Error("gallery_structure_changed");
    }
    // For numbered HTML galleries, do not substitute a recommendation if a
    // listed photo page changes or fails to expose its matching photograph.
    const id = new URL(selected).pathname.match(/\/(\d+)\.html$/)?.[1];
    const thumb = gallery.thumbnails.find((t) => t.pageUrl === selected);
    if (
      id &&
      thumb &&
      !gallery.pictures?.length &&
      new URL(thumb.url).pathname
        .split("/")
        .pop()
        ?.match(new RegExp(`^${id}\\.(?:jpe?g|png|webp|avif)$`, "i")) &&
      (!new URL(photo.picture.url).pathname
        .split("/")
        .pop()
        ?.match(new RegExp(`^${id}\\.(?:jpe?g|png|webp|avif)$`, "i")) ||
        !photo.pages.includes(feature))
    )
      throw Error("gallery_structure_changed");
    return yahooPhotoGallerySchema.parse({
      kind: "gallery",
      articleId,
      featureUrl: feature,
      pageUrl: selected,
      picture: gallery.pictures?.length
        ? gallery.pictures[gallery.pages.indexOf(selected)]
        : photo.picture,
      pages: gallery.pages,
      thumbnails: gallery.thumbnails,
      title: photo.title,
      fetchedAt: new Date(
        Math.min(meta.fetchedAt, first.fetchedAt, current.fetchedAt),
      ).toISOString(),
      status: meta.failed || first.failed || current.failed ? "cached" : "ok",
    });
  }
}
export const yahooPhotoService = new YahooPhotoService(cacheAdapter());
export async function handleYahooPhotos(
  request: Request,
  engine = yahooPhotoService,
  preview = !process.env.VERCEL || process.env.VERCEL_ENV === "preview",
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
    article = p.get("article") || "",
    feature = p.get("feature") || undefined,
    page = p.get("page") || undefined;
  if (
    yahooArticleUrl(article) !== article ||
    (feature && linkedPhotoTarget(feature)?.url !== feature) ||
    (page && (!feature || linkedPhotoTarget(page)?.url !== page)) ||
    [...p.keys()].some(
      (k) =>
        !["article", "feature", "page"].includes(k) || p.getAll(k).length !== 1,
    )
  )
    return Response.json(
      { error: "対応していない写真リンクです。" },
      { status: 400, headers },
    );
  if (!preview)
    return Response.json(
      { error: "個人用プレビュー専用です。" },
      { status: 403, headers },
    );
  try {
    return Response.json(await engine.get(article, feature, page), { headers });
  } catch (e) {
    return Response.json(
      {
        code:
          e instanceof Error && e.message === "incomplete_gallery"
            ? "incomplete_gallery"
            : undefined,
        error:
          e instanceof PhotoAccessError
            ? "この記事に紐づく写真ではありません。"
            : "写真を取得できませんでした。再試行してください。",
      },
      { status: e instanceof PhotoAccessError ? 403 : 503, headers },
    );
  }
}
