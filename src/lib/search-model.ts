import { z } from "zod";
import { feedResponseSchema } from "./model.js";

export const MAX_SEARCH_PAGE = 1000;
export function normalizeSearch(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}
export function validSearch(value: string) {
  const normalized = normalizeSearch(value);
  return (
    normalized.length >= 1 &&
    normalized.length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
  );
}
export const searchCollection = /^search:[a-f0-9]{64}$/;
export const searchResponseSchema = feedResponseSchema.extend({
  bookmarks: z
    .record(z.string(), z.number().int().min(0).max(1_000_000_000))
    .nullable(),
  query: z.string().min(1).max(80),
  page: z.number().int().min(1).max(MAX_SEARCH_PAGE),
  collection: z.string().regex(searchCollection),
  nextSources: z.array(z.enum(["hamusoku", "alfalfa"])).max(2),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export const searchContextSchema = z
  .array(
    z.object({
      id: z.string().max(2048),
      collection: z.string().regex(searchCollection),
      at: z.number(),
    }),
  )
  .max(1000);
