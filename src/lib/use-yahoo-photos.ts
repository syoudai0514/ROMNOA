import { useEffect, useState } from "react";
import {
  yahooPhotoMetadataSchema,
  yahooPhotoGallerySchema,
  type YahooPhotoMetadata,
  type YahooPhotoGallery,
} from "./yahoo-photos-model";

type Resource = YahooPhotoMetadata | YahooPhotoGallery;
const memory = new Map<string, Resource>();
const prefetching = new Map<string, Promise<void>>();
export function prefetchYahooPhoto(
  articleId: string,
  feature: string,
  page: string,
) {
  const params = new URLSearchParams({ article: articleId, feature, page });
  const key = params.toString();
  const cached = memory.get(key);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 3_600_000)
    return Promise.resolve();
  const pending = prefetching.get(key);
  if (pending) return pending;
  const work = (async () => {
    try {
      const res = await fetch(`/api/yahoo-photos?${key}`, {
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) return;
      const data = yahooPhotoGallerySchema.parse(await res.json());
      if (
        data.articleId !== articleId ||
        data.featureUrl !== feature ||
        data.pageUrl !== page
      )
        return;
      memory.set(key, data);
      if (memory.size > 100) memory.delete(memory.keys().next().value!);
    } catch {
      /* Normal loading and retry remain available. */
    }
  })().finally(() => prefetching.delete(key));
  prefetching.set(key, work);
  return work;
}
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
        if (!res.ok) {
          const error = await res.json().catch(() => null);
          throw Error(
            error?.code === "incomplete_gallery"
              ? "incomplete_gallery"
              : "unavailable",
          );
        }
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
      } catch (error) {
        if (live)
          setState({
            key,
            resource: cached || null,
            loading: false,
            error:
              error instanceof Error && error.message === "incomplete_gallery"
                ? "写真一覧をすべて取得できませんでした。元の写真ページで確認できます。"
                : feature
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
