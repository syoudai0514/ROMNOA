import { useEffect, useRef, useState } from "react";
import {
  searchResponseSchema,
  searchContextSchema,
  type SearchResponse,
} from "./search-model";
import type { Article } from "./model";

type SourceId = Article["sourceId"];
const BOTH: SourceId[] = ["hamusoku", "alfalfa"];
const CONTEXT_KEY = "romnoa:search-contexts:v1";
function contexts() {
  try {
    return searchContextSchema
      .parse(JSON.parse(localStorage.getItem(CONTEXT_KEY) || "[]"))
      .filter(
        (row) => Date.now() - row.at < 86400000 && row.at <= Date.now() + 60000,
      );
  } catch {
    return [];
  }
}
export function savedSearchCollection(id: string) {
  return contexts().find((row) => row.id === id)?.collection;
}
function remember(data: SearchResponse) {
  try {
    const added = data.articles.map((a) => ({
      id: a.id,
      collection: data.collection,
      at: Date.now(),
    }));
    localStorage.setItem(
      CONTEXT_KEY,
      JSON.stringify(
        [
          ...added,
          ...contexts().filter((row) => !added.some((a) => a.id === row.id)),
        ].slice(0, 1000),
      ),
    );
  } catch {
    /* Optional lookup hint; saving a favorite still uses the existing storage warning. */
  }
}
export function useSearch(query: string) {
  const [request, setRequest] = useState({ query: "", page: 1, sources: BOTH });
  const [attempt, setAttempt] = useState(0);
  const page = request.query === query ? request.page : 1;
  const sources = request.query === query ? request.sources : BOTH;
  const key = `${query}\n${page}\n${sources.join(",")}`;
  const previousSources = useRef(new Map<string, SourceId[]>());
  const [state, setState] = useState<{
    key: string;
    data: SearchResponse | null;
    loading: boolean;
    error: string;
  }>({ key: "", data: null, loading: false, error: "" });
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    previousSources.current.set(`${query}\n${page}`, sources);
    if (previousSources.current.size > 128)
      previousSources.current.delete(
        previousSources.current.keys().next().value!,
      );
    setState({ key, data: null, loading: true, error: "" });
    void (async () => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&page=${page}&sources=${sources.join(",")}`,
          { signal: abort.signal },
        );
        if (!response.ok) throw new Error("unavailable");
        const data = searchResponseSchema.parse(await response.json());
        if (data.query !== query || data.page !== page)
          throw new Error("mismatch");
        if (!cancelled) {
          remember(data);
          setState({ key, data, loading: false, error: "" });
        }
      } catch {
        if (!cancelled)
          setState({
            key,
            data: null,
            loading: false,
            error:
              "過去記事を検索できませんでした。接続や配信元の状態を確認し、再検索してください。",
          });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      abort.abort();
    };
  }, [query, page, key, sources, attempt]);
  const current =
    state.key === key && query
      ? state
      : { key, data: null, loading: !!query, error: "" };
  return {
    ...current,
    page,
    next: () => {
      if (current.data?.nextSources.length)
        setRequest({
          query,
          page: page + 1,
          sources: current.data.nextSources,
        });
    },
    previous: () =>
      setRequest({
        query,
        page: Math.max(1, page - 1),
        sources:
          previousSources.current.get(`${query}\n${Math.max(1, page - 1)}`) ||
          BOTH,
      }),
    refresh: () => setAttempt((n) => n + 1),
    reset: () => {
      setRequest({ query: "", page: 1, sources: BOTH });
      setAttempt((n) => n + 1);
    },
  };
}
