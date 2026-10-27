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
      u.hostname !== "livedoor.blogimg.jp" ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      !u.pathname.startsWith(`/${folder}/imgs/`) ||
      !/\.(jpe?g|png|gif|webp)$/i.test(u.pathname)
    )
      return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
export const readerDocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
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
