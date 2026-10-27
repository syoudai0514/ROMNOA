import { z } from "zod";
import { sourceInfo } from "./model.js";

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
    articleId: z.string().max(2048),
    sourceId: z.enum(["hamusoku", "alfalfa"]),
    title: z.string().min(1).max(300),
    url: z.url().max(2048),
    fetchedAt: z.iso.datetime(),
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
      d.blocks.every(
        (b) => b.type === "text" || readerImageUrl(b.url, d.sourceId) === b.url,
      )
    );
  });
export type ReaderDocument = z.infer<typeof readerDocumentSchema>;
