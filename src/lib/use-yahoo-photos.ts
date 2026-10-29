import { useEffect, useState } from "react";
import {
  yahooPhotoMetadataSchema,
  yahooPhotoGallerySchema,
  type YahooPhotoMetadata,
  type YahooPhotoGallery,
} from "./yahoo-photos-model";

type Resource = YahooPhotoMetadata | YahooPhotoGallery;
const memory = new Map<string, Resource>();
export function useYahooPhotos(
  articleId: string,
  feature?: string,
  page?: string,
) {
  const params = new URLSearchParams({ article: articleId });
  if (feature) params.set("feature", feature);
  if (page) params.set("page", page);
  const key = params.toString();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    resource: Resource | null;
    loading: boolean;
    error: string;
  }>({ key: "", resource: null, loading: true, error: "" });
  useEffect(() => {
    const cached = memory.get(key);
    if (
      !attempt &&
      cached &&
      Date.now() - Date.parse(cached.fetchedAt) >= 0 &&
      Date.now() - Date.parse(cached.fetchedAt) < 3_600_000
    ) {
      setState({ key, resource: cached, loading: false, error: "" });
      return;
    }
    const controller = new AbortController();
    let live = true;
    const timeout = setTimeout(() => controller.abort(), 25000);
    setState({ key, resource: cached || null, loading: true, error: "" });
    void (async () => {
      try {
        const res = await fetch(`/api/yahoo-photos?${key}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw Error("unavailable");
        const data = (
          feature ? yahooPhotoGallerySchema : yahooPhotoMetadataSchema
        ).parse(await res.json());
        if (
          data.articleId !== articleId ||
          (data.kind === "gallery" &&
            (data.featureUrl !== feature || data.pageUrl !== (page || feature)))
        )
          throw Error("photo_mismatch");
        if (!live) return;
        memory.delete(key);
        memory.set(key, data);
        if (memory.size > 100) memory.delete(memory.keys().next().value!);
        setState({ key, resource: data, loading: false, error: "" });
      } catch {
        if (live)
          setState({
            key,
            resource: cached || null,
            loading: false,
            error: feature
              ? "写真特集を取得できませんでした。再試行してください。"
              : "大きい写真と写真特集を取得できませんでした。再試行できます。",
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
  }, [key, articleId, feature, page, attempt]);
  return {
    ...(state.key === key
      ? state
      : { key, resource: null, loading: true, error: "" }),
    retry: () => setAttempt((n) => n + 1),
  };
}
