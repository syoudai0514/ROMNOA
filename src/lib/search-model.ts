import { z } from "zod";
import { feedResponseSchema } from "./model.js";

export const searchScopeSchema = z.enum(["title", "body"]);
export type SearchScope = z.infer<typeof searchScopeSchema>;
// Space-separated words must all match; NFKC and case folding are shared by both scopes.
export function matchesSearch(text: string, query: string) {
  const haystack = normalizeSearch(text).toLowerCase();
  const words = normalizeSearch(query).toLowerCase().split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

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
  scope: searchScopeSchema.default("title"),
  unverifiedCount: z.number().int().min(0).max(200).default(0),
  excludedCount: z.number().int().min(0).max(200).default(0),
  candidateCount: z.number().int().min(0).max(200).default(0),
  searchedRange: z
    .object({
      from: z.iso.datetime().nullable(),
      to: z.iso.datetime().nullable(),
    })
    .default({ from: null, to: null }),
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
