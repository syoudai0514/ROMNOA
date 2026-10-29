import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Expand, ExternalLink } from "lucide-react";
import type {
  PhotoFeature,
  YahooPhotoGallery,
} from "../lib/yahoo-photos-model";
import { yahooPhotoImagePath } from "../lib/yahoo-photos-model";
import { prefetchYahooPhoto, useYahooPhotos } from "../lib/use-yahoo-photos";
import { ImageViewer } from "./ArticleImages";

export function YahooPhotoFeature({
  articleId,
  feature,
}: {
  articleId: string;
  feature: PhotoFeature;
}) {
  const [page, setPage] = useState(feature.url);
  const [pages, setPages] = useState<string[]>([]);
  const [thumbnails, setThumbnails] = useState<YahooPhotoGallery["thumbnails"]>(
    [],
  );
  const [zoom, setZoom] = useState(false);
  const [failedImage, setFailedImage] = useState("");
  const touch = useRef<{ x: number; y: number } | null>(null);
  const request = useYahooPhotos(articleId, feature.url, page);
  const gallery =
    request.resource?.kind === "gallery" ? request.resource : null;
  const index = pages.indexOf(page);
  useEffect(() => {
    if (gallery) {
      setPages(gallery.pages);
      setThumbnails(gallery.thumbnails);
    }
  }, [gallery]);
  // Keep the next and previous images ready without downloading an entire gallery.
  useEffect(() => {
    if (index < 0) return;
    let active = true;
    const images: HTMLImageElement[] = [];
    for (const next of [pages[index + 1], pages[index - 1]]) {
      if (!next) continue;
      void prefetchYahooPhoto(articleId, feature.url, next).then(() => {
        if (!active) return;
        const image = new Image();
        images.push(image);
        image.src = yahooPhotoImagePath(articleId, feature.url, next);
      });
    }
    return () => {
      active = false;
      images.forEach((image) => {
        image.src = "";
      });
    };
  }, [articleId, feature.url, index, pages]);
  function choose(next: string) {
    if (!zoom && pages.includes(next)) {
      setPage(next);
      setFailedImage("");
    }
  }
  function move(delta: number) {
    const next = pages[index + delta];
    if (next) choose(next);
  }
  const picture = gallery?.picture;
  return (
    <section
      className="inline-photo-feature"
      aria-label="写真特集の写真"
      onKeyDown={(e) => {
        if (!zoom && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          move(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <header>
        <h2>リンク先の写真</h2>
        <span aria-live="polite">
          {index >= 0 ? `${index + 1} / ${pages.length}` : "読み込み中…"}
        </span>
      </header>
      <p className="photo-feature-title">{feature.title}</p>
      {request.loading && !pages.length && (
        <p role="status" className="yahoo-note">
          写真を読み込み中…
        </p>
      )}
      {(request.error || failedImage === page) && (
        <div className="photo-feature-error" role="alert">
          <p>{request.error || "この写真を読み込めませんでした。"}</p>
          <button
            className="button quiet"
            onClick={() => {
              setFailedImage("");
              request.retry();
            }}
          >
            写真を再読み込み
          </button>
          <a
            className="text-button"
            href={page}
            target="_blank"
            rel="noopener noreferrer"
          >
            元の写真ページを開く
            <ExternalLink size={14} />
          </a>
        </div>
      )}
      <div
        className="photo-feature-stage"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current,
            end = e.changedTouches[0];
          touch.current = null;
          if (
            start &&
            end &&
            Math.abs(end.clientX - start.x) > 50 &&
            Math.abs(end.clientX - start.x) >
              Math.abs(end.clientY - start.y) * 1.2
          )
            move(end.clientX < start.x ? 1 : -1);
        }}
      >
        {picture && failedImage !== page && (
          <figure>
            <button
              className="article-picture"
              onClick={() => setZoom(true)}
              aria-label="写真特集の写真を拡大"
            >
              <img
                key={picture.url}
                src={yahooPhotoImagePath(articleId, feature.url, page)}
                alt={picture.alt || feature.title}
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setFailedImage(page)}
              />
              <span className="picture-expand">
                <Expand size={15} />
                拡大
              </span>
            </button>
            <figcaption>
              {picture.caption || picture.alt}
              {picture.credit ? ` / ${picture.credit}` : ""}
            </figcaption>
          </figure>
        )}
      </div>
      <div className="photo-feature-navigation">
        <button
          className="button quiet"
          aria-label="写真特集の前の写真"
          disabled={index <= 0 || request.loading}
          onClick={() => move(-1)}
        >
          <ArrowLeft size={18} />
          前の写真
        </button>
        <span>
          {pages.length ? `${Math.max(0, index) + 1} / ${pages.length}` : "—"}
        </span>
        <button
          className="button quiet"
          aria-label="写真特集の次の写真"
          disabled={index < 0 || index >= pages.length - 1 || request.loading}
          onClick={() => move(1)}
        >
          次の写真
          <ArrowRight size={18} />
        </button>
      </div>
      {!!thumbnails.length && (
        <div
          className="photo-feature-thumbnails"
          role="group"
          aria-label="写真特集の写真一覧"
        >
          {thumbnails.map((t) => (
            <button
              key={t.pageUrl}
              aria-label={`写真特集の${pages.indexOf(t.pageUrl) + 1}枚目を表示`}
              aria-pressed={page === t.pageUrl}
              onClick={() => choose(t.pageUrl)}
            >
              <img
                src={yahooPhotoImagePath(
                  articleId,
                  feature.url,
                  t.pageUrl,
                  true,
                )}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </button>
          ))}
        </div>
      )}
      {gallery?.status === "cached" && (
        <p className="yahoo-note" role="status">
          取得に失敗したため、前回確認した写真を表示しています。
        </p>
      )}
      {zoom && picture && (
        <ImageViewer
          pictures={pages.map((url, i) => ({
            url: yahooPhotoImagePath(articleId, feature.url, url),
            alt: i === index ? picture.alt : `${feature.title} ${i + 1}枚目`,
          }))}
          initial={Math.max(0, index)}
          onClose={(selected) => {
            setZoom(false);
            if (pages[selected]) {
              setPage(pages[selected]);
              setFailedImage("");
            }
          }}
        />
      )}
    </section>
  );
}
