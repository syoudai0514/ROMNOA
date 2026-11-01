import { z } from "zod";
import { yahooArticleUrl } from "./yahoo-model.js";

export const yahooCommentOrderSchema = z.enum(["recommended", "newer"]);
export type YahooCommentOrder = z.infer<typeof yahooCommentOrderSchema>;
const n = z.number().int().min(0).max(100_000_000);
export const yahooCommentSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["user", "expert"]),
  name: z.string().max(80),
  title: z.string().max(120).optional(),
  text: z.string().min(1).max(3000),
  postedAt: z.string().max(40),
  empathy: n,
  insight: n,
  negative: n,
  replies: n,
});
export type YahooComment = z.infer<typeof yahooCommentSchema>;
export const yahooCommentsSchema = z.object({
  article: z
    .string()
    .max(200)
    .refine((s) => yahooArticleUrl(s) === s),
  order: yahooCommentOrderSchema,
  page: z.number().int().min(1).max(50),
  pages: z.number().int().min(1).max(50),
  total: n,
  totalWithReplies: n,
  closed: z.boolean().optional(),
  comments: z.array(yahooCommentSchema).max(30),
});
export type YahooComments = z.infer<typeof yahooCommentsSchema>;
export const yahooCommentsUrl = (article: string) => `${article}/comments`;
