import { z } from "zod";
import { feedResponseSchema } from "./model.js";

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
export function validCollection(value: string, now = Date.now()) {
  return (
    value === "popular" ||
    (value.startsWith("date:") && validDay(value.slice(5), now))
  );
}
export const discoveryResponseSchema = feedResponseSchema.extend({
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
});
export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;
