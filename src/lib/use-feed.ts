import { useCallback, useEffect, useRef, useState } from "react";
import { feedResponseSchema, type FeedResponse } from "./model";
import { loadFeedCache, saveFeedCache } from "./storage";

export function useFeed() {
  const [feed, setFeed] = useState<FeedResponse | null>(loadFeedCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cached, setCached] = useState(!!feed);
  const [storageError, setStorageError] = useState(false);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/articles", {
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("unavailable");
      const data = feedResponseSchema.parse(await response.json());
      setFeed(data);
      setCached(false);
      setError("");
      setStorageError(!saveFeedCache(data));
    } catch {
      setError(
        "新しい記事を取得できませんでした。保存済みの情報があれば表示します。",
      );
      setCached(true);
    } finally {
      setLoading(false);
      pending.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const online = () => {
      setOffline(false);
      void refresh();
    };
    const offline = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [refresh]);
  return { feed, loading, error, offline, cached, storageError, refresh };
}
