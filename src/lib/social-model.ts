import { z } from "zod";
export { socialPostUrl } from "./reader-media.js";

const https = (hosts: RegExp) =>
  z
    .string()
    .max(2048)
    .refine((s) => {
      try {
        const u = new URL(s);
        return u.protocol === "https:" && hosts.test(u.hostname);
      } catch {
        return false;
      }
    });
const mediaHost =
  /^(?:pbs\.twimg\.com|video\.twimg\.com|[a-z0-9.-]+\.cdninstagram\.com)$/;
export const socialPostSchema = z.object({
  provider: z.enum(["X", "Instagram"]),
  url: https(/^(?:x\.com|www\.instagram\.com)$/),
  author: z.string().max(100),
  handle: z.string().max(30),
  text: z.string().max(1200),
  createdAt: z.iso.datetime().optional(),
  media: z
    .array(
      z.object({
        type: z.enum(["photo", "video", "gif"]),
        url: https(mediaHost),
        poster: https(mediaHost).optional(),
      }),
    )
    .max(10),
});
export type SocialPost = z.infer<typeof socialPostSchema>;
