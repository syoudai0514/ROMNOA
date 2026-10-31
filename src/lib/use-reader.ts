import { useEffect, useState } from "react";
import { cacheReader, cachedReader } from "./reader-cache";
import { readerDocumentSchema, type ReaderDocument } from "./reader-model";

export function useReader(
  id: string,
  from?: string,
  collection?: string,
  saved = false,
  parentSaved = false,
) {
  const [state, setState] = useState<{
    id: string;
    document: ReaderDocument | null;
    loading: boolean;
    error: string;
    storageError: boolean;
  }>({ id, document: null, loading: true, error: "", storageError: false });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 18000);
    setState({
      id,
      document: null,
      loading: true,
      error: "",
      storageError: false,
    });
    void (async () => {
      const cached = await cachedReader(id);
      if (cancelled) return;
      if (cached) {
        clearTimeout(timeout);
        setState({
          id,
          document: cached,
          loading: false,
          error: "",
          storageError: false,
        });
        return;
      }
      try {
        const url = `/api/reader?article=${encodeURIComponent(id)}${from ? `&from=${encodeURIComponent(from)}` : ""}${collection ? `&collection=${encodeURIComponent(collection)}` : ""}${saved ? "&saved=1" : ""}`;
        let response = await fetch(url, { signal: abort.signal });
        if (response.status === 404 && from) {
          // A locally cached parent can outlive the server's short-lived cache.
          // Refresh it through the same verified endpoint before retrying.
          const parent = await fetch(
            `/api/reader?article=${encodeURIComponent(from)}${collection ? `&collection=${encodeURIComponent(collection)}` : ""}${parentSaved ? "&saved=1" : ""}`,
            { signal: abort.signal },
          );
          if (parent.ok) response = await fetch(url, { signal: abort.signal });
        }
        const value = await response.json();
        if (!response.ok)
          throw new Error(
            typeof value?.error === "string"
              ? value.error
              : "本文を取得できませんでした。",
          );
        const document = readerDocumentSchema.parse(value);
        if (document.articleId !== id)
          throw new Error("記事が一致しませんでした。");
        if (cancelled) return;
        const stored = await cacheReader(document);
        if (!cancelled)
          setState({
            id,
            document,
            loading: false,
            error: "",
            storageError: !stored,
          });
      } catch (e) {
        if (!cancelled)
          setState({
            id,
            document: null,
            loading: false,
            error: !navigator.onLine
              ? "オフラインです。まだ本文を保存していない記事は、接続後に開いてください。"
              : e instanceof Error &&
                  e.name !== "AbortError" &&
                  e.name !== "ZodError"
                ? e.message
                : "本文を取得できませんでした。再試行してください。",
            storageError: false,
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
  }, [id, from, collection, saved, parentSaved, attempt]);
  return {
    ...(state.id === id
      ? state
      : { id, document: null, loading: true, error: "", storageError: false }),
    retry: () => retry((n) => n + 1),
  };
}
