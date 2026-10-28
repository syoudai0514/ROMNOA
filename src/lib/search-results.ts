import { newest, type Article } from "./model.js";
import { matchesSearch, type SearchResponse } from "./search-model.js";

export const SEARCH_BATCH_PAGES = 5;
export const SEARCH_BATCH_MATCHES = 20;

export function appendSearchPage(
  old: SearchResponse | null,
  page: SearchResponse,
): SearchResponse {
  if (!old) return page;
  if (
    old.query !== page.query ||
    old.scope !== page.scope ||
    page.page <= old.page
  )
    throw new Error("search_page_mismatch");
  const dates = [
    old.searchedRange.from,
    old.searchedRange.to,
    page.searchedRange.from,
    page.searchedRange.to,
  ]
    .filter((d): d is string => !!d)
    .sort();
  return {
    ...page,
    articles: [
      ...new Map(
        [...old.articles, ...page.articles].map((a) => [a.id, a]),
      ).values(),
    ].sort(newest),
    sources: [
      ...new Map(
        [...old.sources, ...page.sources].map((s) => [s.id, s]),
      ).values(),
    ],
    bookmarks:
      old.bookmarks && page.bookmarks
        ? { ...old.bookmarks, ...page.bookmarks }
        : null,
    excludedCount: old.excludedCount + page.excludedCount,
    unverifiedCount: old.unverifiedCount + page.unverifiedCount,
    candidateCount: old.candidateCount + page.candidateCount,
    searchedRange: { from: dates[0] || null, to: dates.at(-1) || null },
  };
}

// Local titles are already publisher metadata saved by this reader. Never search
// cached display bodies, which may contain article link labels, or invent dates.
export function mergeLocalSearch(
  remote: Article[],
  local: Article[],
  query: string,
) {
  const found = new Map(remote.map((a) => [a.id, a]));
  for (const a of local)
    if (!found.has(a.id) && matchesSearch(a.title, query)) found.set(a.id, a);
  return [...found.values()].sort(newest);
}

export function searchDay(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value))
    : "不明";
}
