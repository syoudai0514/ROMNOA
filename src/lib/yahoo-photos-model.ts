import { z } from "zod";
import { yahooArticleUrl, yahooImageUrl } from "./yahoo-model.js";

export function photoFeatureTarget(raw: string, base?: string) {
  try {
    const u = new URL(raw, base);
    const match = u.pathname.match(
      /^\/article\/(\d{8}dog\d{2}m\d{9}[a-z])\/photopage\/([0-9]{3})\.html$/,
    );
    if (
      u.protocol !== "https:" ||
      !["gravure.mantan-web.jp", "mantan-web.jp"].includes(u.hostname) ||
      u.port ||
      u.username ||
      u.password ||
      u.hash ||
      !match ||
      Number(match[2]) < 1 ||
      [...u.searchParams].some(([k, v]) => k !== "ext_m" || v !== "y")
    )
      return null;
    u.search = "";
    return { url: u.href, family: match[1], page: match[2], host: u.hostname };
  } catch {
    return null;
  }
}
export function mantanPhotoUrl(raw: string, family?: string) {
  try {
    const u = new URL(raw);
    const match = u.pathname.match(
      /^\/(?:[a-z]=[a-zA-Z0-9=,:_-]+\/)?images\/\d{4}\/\d{2}\/\d{2}\/(\d{8}dog\d{2}m\d{9}[a-z])\/\d{3}\.(?:jpg|jpeg|png|webp)$/,
    );
    return u.protocol === "https:" &&
      u.hostname === "storage.mantan-web.jp" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      match &&
      (!family || match[1] === family)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export const yahooPictureSchema = z.object({
  url: z
    .string()
    .max(2048)
    .refine((s) => yahooImageUrl(s) === s || mantanPhotoUrl(s) === s),
  alt: z.string().max(500),
  caption: z.string().max(500).optional(),
  credit: z.string().max(200).optional(),
});
export type YahooPicture = z.infer<typeof yahooPictureSchema>;
export const photoFeatureSchema = z.object({
  title: z.string().min(1).max(500),
  url: z
    .string()
    .max(400)
    .refine((s) => photoFeatureTarget(s)?.url === s),
});
export type PhotoFeature = z.infer<typeof photoFeatureSchema>;
export function yahooPhotoImagePath(
  articleId: string,
  feature: string,
  page: string,
  thumbnail = false,
) {
  return `/api/yahoo-photo-image?${new URLSearchParams({ article: articleId, feature, page, size: thumbnail ? "thumb" : "full" })}`;
}
export const photoThumbnailSchema = z.object({
  pageUrl: photoFeatureSchema.shape.url,
  url: z
    .string()
    .max(2048)
    .refine((s) => mantanPhotoUrl(s) === s),
});
const common = {
  articleId: z
    .string()
    .max(200)
    .refine((s) => yahooArticleUrl(s) === s),
  fetchedAt: z.iso.datetime(),
  status: z.enum(["ok", "cached"]),
};
export const yahooPhotoMetadataSchema = z.object({
  ...common,
  kind: z.literal("article"),
  pictures: z.array(yahooPictureSchema).max(40),
  features: z.array(photoFeatureSchema).max(12),
});
export type YahooPhotoMetadata = z.infer<typeof yahooPhotoMetadataSchema>;
export const yahooPhotoGallerySchema = z.object({
  ...common,
  kind: z.literal("gallery"),
  featureUrl: photoFeatureSchema.shape.url,
  pageUrl: photoFeatureSchema.shape.url,
  picture: yahooPictureSchema,
  pages: z.array(photoFeatureSchema.shape.url).min(1).max(80),
  thumbnails: z.array(photoThumbnailSchema).max(80).default([]),
  title: z.string().max(500),
});
export type YahooPhotoGallery = z.infer<typeof yahooPhotoGallerySchema>;
