import { z } from "zod";
import { articleSchema, sourceInfo } from "./model.js";

export function readerArticleTarget(raw: string) {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      return null;
    const sourceId =
      u.hostname === "hamusoku.com" &&
      /^\/archives\/[1-9]\d{5,11}\.html$/.test(u.pathname)
        ? "hamusoku"
        : u.hostname === "alfalfalfa.com" &&
            /^\/articles\/[1-9]\d{5,11}\.html$/.test(u.pathname)
          ? "alfalfa"
          : null;
    return sourceId ? ({ sourceId, url: u.href } as const) : null;
  } catch {
    return null;
  }
}

export function readerImageUrl(raw: string, sourceId: string): string | null {
  try {
    const u = new URL(raw);
    const folder =
      sourceId === "hamusoku"
        ? "hamusoku"
        : sourceId === "alfalfa"
          ? "amosaic"
          : "";
    if (
      !folder ||
      u.protocol !== "https:" ||
      u.port ||
      u.username ||
      u.password
    )
      return null;
    const publisher =
      u.hostname === "livedoor.blogimg.jp" &&
      !u.search &&
      u.pathname.startsWith(`/${folder}/imgs/`) &&
      /\.(jpe?g|png|gif|webp)$/i.test(u.pathname);
    const socialImage =
      u.hostname === "pbs.twimg.com" &&
      /^\/media\/[A-Za-z0-9_-]{1,128}(?:\.(?:jpe?g|png|webp))?$/.test(
        u.pathname,
      ) &&
      (/\.(?:jpe?g|png|webp)$/.test(u.pathname) ||
        /^(?:jpg|png|webp)$/.test(u.searchParams.get("format") || "")) &&
      [...u.searchParams.keys()].every(
        (key) =>
          (key === "format" || key === "name") &&
          u.searchParams.getAll(key).length === 1,
      ) &&
      (!u.searchParams.has("format") ||
        /^(?:jpg|png|webp)$/.test(u.searchParams.get("format")!)) &&
      (!u.searchParams.has("name") ||
        /^(?:orig|large|medium|small|thumb|[1-9]\d{0,3}x[1-9]\d{0,3})$/.test(
          u.searchParams.get("name")!,
        ));
    if (!publisher && !socialImage) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

// Explicit browser navigation only. This never authorizes server-side fetching.
export function readerLinkUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (
      !/^https?:$/.test(u.protocol) ||
      u.username ||
      u.password ||
      u.port ||
      !u.hostname.includes(".") ||
      u.hostname.startsWith("[") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname) ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export const readerDocumentSchema = z
  .object({
    schemaVersion: z.literal(3),
    pageKind: z.enum(["article", "roundup"]),
    links: z
      .array(
        z.object({
          url: z.string().max(2048),
          title: z.string().min(1).max(300),
        }),
      )
      .max(40),
    articleId: z.string().max(2048),
    sourceId: z.enum(["hamusoku", "alfalfa"]),
    title: z.string().min(1).max(300),
    url: z.url().max(2048),
    fetchedAt: z.iso.datetime(),
    imageAudit: z
      .object({
        excluded: z.number().int().min(0).max(10000),
        uncertain: z.number().int().min(0).max(10000),
        related: z.number().int().min(0).max(10000),
      })
      .default({ excluded: 0, uncertain: 0, related: 0 }),
    related: z
      .array(
        z.object({
          article: articleSchema,
          thumbnail: z.string().max(2048).nullable(),
        }),
      )
      .max(12)
      .default([]),
    blocks: z
      .array(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("text"),
            text: z.string().min(1).max(12000),
          }),
          z.object({
            type: z.literal("image"),
            url: z.string().max(2048),
            alt: z.string().max(160),
            role: z.enum(["cover", "body"]).optional(),
          }),
        ]),
      )
      .min(1)
      .max(600),
  })
  .refine((d) => {
    const source = sourceInfo.find((s) => s.id === d.sourceId)!;
    const u = new URL(d.url);
    return (
      d.articleId === d.url &&
      u.protocol === "https:" &&
      u.hostname === new URL(source.url).hostname &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      readerArticleTarget(d.url)?.sourceId === d.sourceId &&
      d.links.every((link) => readerLinkUrl(link.url) === link.url) &&
      d.related.every(
        (r) =>
          r.article.id !== d.articleId &&
          readerArticleTarget(r.article.url)?.sourceId === r.article.sourceId &&
          (!r.thumbnail ||
            readerImageUrl(r.thumbnail, r.article.sourceId) === r.thumbnail),
      ) &&
      d.blocks.every(
        (b) => b.type === "text" || readerImageUrl(b.url, d.sourceId) === b.url,
      )
    );
  });
export type ReaderDocument = z.infer<typeof readerDocumentSchema>;
