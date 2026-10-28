import { useEffect, useState } from "react";
import {
  discoveryResponseSchema,
  type DiscoveryResponse,
} from "./discovery-model";

const CACHE_KEY = "romnoa:discovery:v1";
type Cached = { key: string; savedAt: number; data: DiscoveryResponse };
function readCache(key: string): DiscoveryResponse | null {
  try {
    const rows: Cached[] = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    if (!Array.isArray(rows)) return null;
    const row = rows.find(
      (row) =>
        row.key === key &&
        row.savedAt <= Date.now() + 60000 &&
        Date.now() - row.savedAt < 86400000,
    );
    if (!row) return null;
    const data = discoveryResponseSchema.parse(row.data);
    return `${data.mode}:${data.date || ""}` === key ? data : null;
  } catch {
    return null;
  }
}
function saveCache(key: string, data: DiscoveryResponse) {
  try {
    const old = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify(
        [
          { key, savedAt: Date.now(), data },
          ...(Array.isArray(old) ? old.filter((r) => r?.key !== key) : []),
        ].slice(0, 8),
      ),
    );
    return true;
  } catch {
    return false;
  }
}
export function useDiscovery(mode: "popular" | "date" | null, date: string) {
  const key = `${mode || ""}:${date}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data: DiscoveryResponse | null;
    loading: boolean;
    error: string;
    cached: boolean;
    storageError: boolean;
  }>({
    key: "",
    data: null,
    loading: false,
    error: "",
    cached: false,
    storageError: false,
  });
  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    const controller = new AbortController();
    const data = readCache(key);
    setState({
      key,
      data,
      loading: true,
      error: "",
      cached: !!data,
      storageError: false,
    });
    const timeout = setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const response = await fetch(
          `/api/discovery?mode=${mode}${date ? `&date=${date}` : ""}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("unavailable");
        const result = discoveryResponseSchema.parse(await response.json());
        if (result.mode !== mode || result.date !== (date || null))
          throw new Error("mismatch");
        if (cancelled) return;
        setState({
          key,
          data: result,
          loading: false,
          error: "",
          cached: false,
          storageError: !saveCache(key, result),
        });
      } catch {
        if (!cancelled)
          setState({
            key,
            data,
            loading: false,
            cached: !!data,
            storageError: false,
            error:
              "この一覧を取得できませんでした。端末に残っている同じ条件の情報があれば表示します。",
          });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [mode, date, key, attempt]);
  return {
    ...(mode && state.key === key
      ? state
      : {
          key,
          data: null,
          loading: !!mode,
          error: "",
          cached: false,
          storageError: false,
        }),
    refresh: () => setAttempt((n) => n + 1),
  };
}
