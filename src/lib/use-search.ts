import { useEffect, useRef, useState } from "react";
import {
  searchResponseSchema,
  searchContextSchema,
  type SearchResponse,
  type SearchScope,
} from "./search-model";
import {
  appendSearchPage,
  SEARCH_BATCH_PAGES,
  SEARCH_BATCH_MATCHES,
} from "./search-results";
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
export function savedArticleCollection(id: string) {
  return contexts().find((row) => row.id === id)?.collection;
}
export function rememberArticleCollection(data: {
  articles: Article[];
  collection: string;
}) {
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
export function useSearch(query: string, scope: SearchScope = "title") {
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(0);
  const key = `${query}\n${scope}\n${attempt}`;
  type Snapshot = {
    key: string;
    data: SearchResponse | null;
    collections: Record<string, string>;
  };
  const snapshot = useRef<Snapshot>({ key: "", data: null, collections: {} });
  const [state, setState] = useState<
    Snapshot & { searching: boolean; error: string }
  >({ key: "", data: null, collections: {}, searching: false, error: "" });
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const abort = new AbortController();
    let saved: Snapshot =
      snapshot.current.key === key
        ? snapshot.current
        : { key, data: null, collections: {} };
    const initialCount = saved.data?.articles.length || 0;
    setState({ ...saved, searching: true, error: "" });
    void (async () => {
      let error = "";
      try {
        for (let scanned = 0; scanned < SEARCH_BATCH_PAGES; scanned++) {
          const page = (saved.data?.page || 0) + 1;
          const sources = saved.data ? saved.data.nextSources : BOTH;
          if (!sources.length) break;
          const timeout = setTimeout(() => abort.abort(), 45000);
          let data: SearchResponse;
          try {
            const response = await fetch(
              `/api/search?q=${encodeURIComponent(query)}&page=${page}&scope=${scope}&sources=${sources.join(",")}`,
              { signal: abort.signal },
            );
            if (!response.ok) throw new Error("unavailable");
            data = searchResponseSchema.parse(await response.json());
            if (
              data.query !== query ||
              data.page !== page ||
              data.scope !== scope
            )
              throw new Error("mismatch");
          } finally {
            clearTimeout(timeout);
          }
          if (cancelled) return;
          rememberArticleCollection(data);
          const collections = { ...saved.collections };
          for (const a of data.articles) collections[a.id] = data.collection;
          saved = {
            key,
            data: appendSearchPage(saved.data, data),
            collections,
          };
          snapshot.current = saved;
          setState({ ...saved, searching: true, error: "" });
          if (data.sources.some((s) => s.status === "error")) {
            error =
              "一部の配信元を確認できませんでした。更新すると再検索できます。";
            break;
          }
          if (
            saved.data!.articles.length - initialCount >=
            SEARCH_BATCH_MATCHES
          )
            break;
        }
      } catch {
        error = saved.data
          ? "続きの検索を取得できませんでした。表示済みの記事は残しています。「さらに過去の記事」で再試行できます。"
          : "過去記事を検索できませんでした。接続や配信元の状態を確認し、再検索してください。";
      } finally {
        if (!cancelled) setState({ ...saved, searching: false, error });
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [query, scope, key, more]);
  const current =
    state.key === key && query
      ? state
      : { key, data: null, collections: {}, searching: !!query, error: "" };
  return {
    ...current,
    loading: current.searching && !current.data,
    page: current.data?.page || 0,
    next: () => {
      if (!current.searching && current.data?.nextSources.length)
        setMore((n) => n + 1);
    },
    refresh: () => setAttempt((n) => n + 1),
    reset: () => setAttempt((n) => n + 1),
  };
}
