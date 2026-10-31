import type { YahooArticle } from "./yahoo-model";

const DAY = 86_400_000;
const weekdays = "日月火水木金土";
function isoDay(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}
function calendarDay(year: number, month: number, day: number, weekday?: string) {
  const value = Date.UTC(year, month - 1, day);
  const date = new Date(value);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || (weekday && weekdays[date.getUTCDay()] !== weekday)) return null;
  return value;
}
// Search excerpts often omit the year. An unambiguous article timestamp or a
// year printed by Yahoo is preferred. Otherwise require corroborating dated
// Yahoo thumbnail metadata, matching the date within two days and the weekday.
export function yahooSearchDay(article: YahooArticle): string | null {
  if (article.publishedAt) {
    const value = Date.parse(article.publishedAt);
    if (Number.isFinite(value)) return isoDay(value + 9 * 3_600_000);
  }
  const match = article.displayDate?.match(/^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?:\(([日月火水木金土])\))?/);
  if (!match) return null;
  const [, year, month, day, weekday] = match;
  if (year) {
    const value = calendarDay(Number(year), Number(month), Number(day), weekday);
    return value === null ? null : isoDay(value);
  }
  if (!weekday || !article.image) return null;
  const image = article.image.match(/^https:\/\/newsatcl-pctr\.c\.yimg\.jp\/t\/amd-img\/(\d{4})(\d{2})(\d{2})-/);
  if (!image) return null;
  const imageDay = calendarDay(Number(image[1]), Number(image[2]), Number(image[3]));
  if (imageDay === null) return null;
  const candidates = [Number(image[1]) - 1, Number(image[1]), Number(image[1]) + 1]
    .map((y) => calendarDay(y, Number(month), Number(day), weekday))
    .filter((n): n is number => n !== null && Math.abs(n - imageDay) <= 2 * DAY);
  return candidates.length === 1 ? isoDay(candidates[0]) : null;
}
export function inYahooSearchPeriod(day: string | null, from: string, to: string) {
  return !!day && (!from || day >= from) && (!to || day <= to);
}
