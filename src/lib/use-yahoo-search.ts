import { useEffect, useState } from "react";
import {
  yahooSearchResponseSchema,
  type YahooSearchResponse,
} from "./yahoo-model";

export function useYahooSearch(
  query: string,
  scope: "title" | "summary",
  limit = 50,
) {
  const [attempt, setAttempt] = useState(0);
  const key = `${query}\n${scope}\n${limit}\n${attempt}`;
  const [state, setState] = useState<{
    key: string;
    data: YahooSearchResponse | null;
    searching: boolean;
    error: string;
  }>({ key: "", data: null, searching: false, error: "" });
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let live = true;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setState({ key, data: null, searching: true, error: "" });
    void (async () => {
      try {
        const res = await fetch(
          `/api/yahoo-search?q=${encodeURIComponent(query)}&scope=${scope}&limit=${limit}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error("unavailable");
        const data = yahooSearchResponseSchema.parse(await res.json());
        if (data.query !== query || data.scope !== scope)
          throw new Error("mismatch");
        if (live) setState({ key, data, searching: false, error: "" });
      } catch {
        if (live)
          setState({
            key,
            data: null,
            searching: false,
            error:
              "Yahooニュースを検索できませんでした。再試行するか、Yahooの検索画面で確認してください。",
          });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      live = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, scope, key]);
  return {
    ...(query && state.key === key
      ? state
      : { key, data: null, searching: !!query, error: "" }),
    retry: () => setAttempt((n) => n + 1),
  };
}
