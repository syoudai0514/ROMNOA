import { z } from "zod";
import { articleSchema, feedResponseSchema } from "./model.js";
import { searchCollection } from "./search-model.js";

export function japanDay(value: string | number = Date.now()) {
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms)
    ? new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10)
    : "";
}
export function validDay(day: string, now = Date.now()) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    day < "2005-01-01" ||
    day > japanDay(now)
  )
    return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day
  );
}
export function shiftDay(day: string, delta: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
export function shiftMonth(day: string, delta: number) {
  const value = new Date(`${day}T00:00:00Z`);
  const year = value.getUTCFullYear(),
    month = value.getUTCMonth() + delta;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), last)))
    .toISOString()
    .slice(0, 10);
}
export const popularCollection = /^popular:[a-f0-9]{64}$/;
export function validCollection(value: string, now = Date.now()) {
  return (
    value === "popular" ||
    popularCollection.test(value) ||
    searchCollection.test(value) ||
    (value.startsWith("date:") && validDay(value.slice(5), now))
  );
}
export const discoveryResponseSchema = feedResponseSchema.extend({
  articles: z.array(articleSchema).max(220),
  collection: z.string().regex(popularCollection).optional(),
  rankingBasis: z.enum(["publisher", "bookmarks"]).default("publisher"),
  bookmarks: z
    .record(z.string(), z.number().int().min(0).max(1_000_000_000))
    .nullable()
    .default(null),
  partialSources: z
    .array(z.enum(["hamusoku", "alfalfa"]))
    .max(2)
    .default([]),
  mode: z.enum(["popular", "date"]),
  date: z.string().nullable(),
  ranks: z
    .array(
      z.object({
        id: z.string().max(2048),
        rank: z.number().int().min(1).max(10),
      }),
    )
    .max(20),
  limitedSources: z.array(z.enum(["hamusoku", "alfalfa"])).max(2),
  unavailableSources: z
    .array(z.enum(["hamusoku", "alfalfa"]))
    .max(2)
    .default([]),
});
export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;
