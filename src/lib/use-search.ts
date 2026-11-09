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
  appendArchiveSearch,
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
export function useSearch(
  query: string,
  scope: SearchScope = "title",
  from = "",
  to = "",
) {
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(0);
  const [pausedKey, setPausedKey] = useState("");
  const key = `${query}\n${scope}\n${from}\n${to}\n${attempt}`;
  type Snapshot = {
    key: string;
    data: SearchResponse | null;
    collections: Record<string, string>;
    nativeDone: boolean;
    cursor: string | undefined;
    archiveDone: boolean;
  };
  const snapshot = useRef<Snapshot>({
    key: "",
    data: null,
    collections: {},
    nativeDone: false,
    cursor: undefined,
    archiveDone: false,
  });
  const [state, setState] = useState<
    Snapshot & { searching: boolean; error: string }
  >({ ...snapshot.current, searching: false, error: "" });
  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const abort = new AbortController();
    let saved: Snapshot =
      snapshot.current.key === key
        ? snapshot.current
        : {
            key,
            data: null,
            collections: {},
            nativeDone: false,
            cursor: undefined,
            archiveDone: false,
          };
    if (pausedKey === key) {
      setState({ ...saved, searching: false, error: "" });
      return;
    }
    const publish = (data: SearchResponse, archive: boolean) => {
      rememberArticleCollection(data);
      const collections = { ...saved.collections };
      for (const a of data.articles) collections[a.id] = data.collection;
      saved = {
        ...saved,
        data: archive
          ? appendArchiveSearch(saved.data, data)
          : appendSearchPage(saved.data, data),
        collections,
      };
      if (archive) {
        saved.cursor = data.archive!.cursor || undefined;
        saved.archiveDone = data.archive!.complete;
      }
      snapshot.current = saved;
      setState({ ...saved, searching: true, error: "" });
    };
    const request = async (url: string) => {
      const requestAbort = new AbortController();
      const cancelRequest = () => requestAbort.abort();
      if (abort.signal.aborted) cancelRequest();
      abort.signal.addEventListener("abort", cancelRequest, { once: true });
      // An optional provider-search timeout must not abort the independent
      // archive scan; only leaving/pausing the search cancels the whole run.
      const timer = setTimeout(cancelRequest, 55000);
      try {
        const response = await fetch(url, { signal: requestAbort.signal });
        if (!response.ok) throw Error("unavailable");
        const data = searchResponseSchema.parse(await response.json());
        if (data.query !== query || data.scope !== scope)
          throw Error("mismatch");
        return data;
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", cancelRequest);
      }
    };
    setState({ ...saved, searching: true, error: "" });
    void (async () => {
      let error = "";
      try {
        if (!saved.nativeDone) {
          // Fast first results, followed by the independent public archive scan.
          try {
            for (let n = 0; n < SEARCH_BATCH_PAGES; n++) {
              const page = (saved.data?.page || 0) + 1;
              const sources = saved.data ? saved.data.nextSources : BOTH;
              if (!sources.length) break;
              const data = await request(
                `/api/search?q=${encodeURIComponent(query)}&page=${page}&scope=${scope}&sources=${sources.join(",")}`,
              );
              if (cancelled) return;
              if (data.page !== page) throw Error("mismatch");
              publish(data, false);
              if (data.sources.some((s) => s.status === "error")) break;
            }
          } catch {
            if (abort.signal.aborted) throw Error("aborted");
          }
          saved = { ...saved, nativeDone: true };
          snapshot.current = saved;
        }
        while (!saved.archiveDone && !cancelled) {
          const p = new URLSearchParams({ q: query, scope, archive: "1" });
          if (saved.cursor) p.set("cursor", saved.cursor);
          if (from) p.set("from", from);
          if (to) p.set("to", to);
          const data = await request(`/api/search?${p}`);
          if (cancelled) return;
          if (!data.archive) throw Error("missing_archive_status");
          publish(data, true);
          if (
            data.archive.failed ||
            data.sources.some((s) => s.status === "error")
          ) {
            error =
              "一部のアーカイブを取得できませんでした。確認済みの記事は残しています。「検索を続ける」で未取得分を再試行します。";
            break;
          }
        }
      } catch {
        error = saved.data
          ? "検索を中断しました。確認済みの記事は残しています。「検索を続ける」で再試行できます。"
          : "過去記事を検索できませんでした。接続を確認して再試行してください。";
      } finally {
        if (!cancelled) setState({ ...saved, searching: false, error });
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [query, scope, key, more, pausedKey, from, to]);
  const current =
    state.key === key && query
      ? state
      : {
          key,
          data: null,
          collections: {},
          nativeDone: false,
          cursor: undefined,
          archiveDone: false,
          searching: !!query,
          error: "",
        };
  return {
    ...current,
    loading: current.searching && !current.data,
    page: current.data?.page || 0,
    next: () => {
      setPausedKey("");
      setMore((n) => n + 1);
    },
    pause: () => setPausedKey(key),
    refresh: () => {
      setPausedKey("");
      setAttempt((n) => n + 1);
    },
    reset: () => {
      setPausedKey("");
      setAttempt((n) => n + 1);
    },
  };
}
