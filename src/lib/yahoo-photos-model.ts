import { socialPostUrl } from "./reader-media.js";
import { publicPhotoUrl } from "./public-photo-url.js";
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
export function linkedPhotoTarget(raw: string, base?: string) {
  const mantan = photoFeatureTarget(raw, base);
  if (mantan) return mantan;
  const url = publicPhotoUrl(raw, base);
  if (!url) return null;
  const u = new URL(url);
  // Yahoo embeds tracking in fragments on some publisher links.
  if (u.hash && /^#utm_[a-z_]+=[^#]*$/i.test(u.hash)) u.hash = "";
  // Keep the strict adapter's validation for its own hosts.
  if (
    /(^|\.)mantan-web\.jp$/.test(u.hostname) ||
    u.hostname === "news.yahoo.co.jp" ||
    (u.hash && !/^#romnoa-photo-(?:[2-9]|[1-3][0-9]|40)$/.test(u.hash))
  )
    return null;
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith("utm_") || key === "in") u.searchParams.delete(key);
  return { url: u.href, host: u.hostname, family: "", page: "" };
}
export function linkedImageUrl(raw: string) {
  return publicPhotoUrl(raw);
}
export function mantanPhotoUrl(raw: string, family?: string) {
  try {
    const u = new URL(raw);
    const match = u.pathname.match(
      /^\/(?:[a-z]=[a-zA-Z0-9=,:_-]+\/)?images\/\d{4}\/\d{2}\/\d{2}\/(\d{8}dog\d{2}m\d{9}[a-z])\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}\.(?:jpg|jpeg|png|webp)$/,
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
    .refine((s) => yahooImageUrl(s) === s || linkedImageUrl(s) === s),
  alt: z.string().max(500),
  caption: z.string().max(500).optional(),
  credit: z.string().max(200).optional(),
});
export type YahooPicture = z.infer<typeof yahooPictureSchema>;
export const photoFeatureSchema = z.object({
  title: z.string().min(1).max(500),
  url: z
    .string()
    .max(2048)
    .refine((s) => linkedPhotoTarget(s)?.url === s),
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
    .refine((s) => linkedImageUrl(s) === s),
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
export const embeddedPostSchema = z.object({
  provider: z.enum(["X", "Instagram"]),
  url: z
    .string()
    .max(2048)
    .refine((s) => socialPostUrl(s)?.url === s),
});
export const yahooPhotoGallerySchema = z.object({
  ...common,
  kind: z.literal("gallery"),
  posts: z.array(embeddedPostSchema).max(12).optional(),
  featureUrl: photoFeatureSchema.shape.url,
  pageUrl: photoFeatureSchema.shape.url,
  picture: yahooPictureSchema,
  pages: z.array(photoFeatureSchema.shape.url).min(1).max(80),
  thumbnails: z.array(photoThumbnailSchema).max(80).default([]),
  title: z.string().max(500),
});
export type YahooPhotoGallery = z.infer<typeof yahooPhotoGallerySchema>;
