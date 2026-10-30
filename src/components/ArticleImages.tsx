import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Expand, X } from "lucide-react";

export type Picture = { url: string; alt: string; role?: "cover" | "body" };

function Picture({
  picture,
  onOpen,
  eager,
}: {
  picture: Picture;
  onOpen: () => void;
  eager: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [picture.url]);
  return failed ? (
    <p className="reader-image-placeholder" role="status">
      この画像を読み込めませんでした。
    </p>
  ) : (
    <button
      className="article-picture"
      onClick={onOpen}
      aria-label={`${picture.alt}を拡大`}
    >
      <img
        src={picture.url}
        alt={picture.alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      <span className="picture-expand">
        <Expand size={15} aria-hidden="true" />
        拡大
      </span>
    </button>
  );
}

export function ImageViewer({
  pictures,
  initial,
  onClose,
}: {
  pictures: Picture[];
  initial: number;
  onClose: (index: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initial);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const images = [pictures[index - 1], pictures[index + 1]]
      .filter(Boolean)
      .map((p) => {
        const image = new Image();
        image.src = p.url;
        return image;
      });
    return () => {
      images.forEach((image) => {
        image.src = "";
      });
    };
  }, [index, pictures]);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label="記事画像の拡大表示"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose(index);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
        if (event.key === "ArrowRight")
          setIndex((i) => Math.min(pictures.length - 1, i + 1));
      }}
    >
      <header>
        <span>
          記事内の画像 {index + 1} / {pictures.length}
        </span>
        <button
          className="icon-button"
          onClick={() => onClose(index)}
          aria-label="拡大画像を閉じる"
          autoFocus
        >
          <X />
        </button>
      </header>
      <div
        className="image-viewer-canvas"
        onTouchStart={(event) => {
          const t = event.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touch.current,
            end = event.changedTouches[0];
          touch.current = null;
          if (!start || !end) return;
          const x = end.clientX - start.x,
            y = end.clientY - start.y;
          if (Math.abs(x) > 50 && Math.abs(x) > Math.abs(y) * 1.2)
            setIndex((i) =>
              Math.max(0, Math.min(pictures.length - 1, i + (x < 0 ? 1 : -1))),
            );
        }}
      >
        <img
          key={pictures[index].url}
          src={pictures[index].url}
          alt={pictures[index].alt}
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.alt = "この画像を読み込めませんでした。";
          }}
        />
      </div>
      <footer>
        <button
          className="button quiet"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
          aria-label="前の画像"
        >
          <ArrowLeft />
          前の画像
        </button>
        <button
          className="button quiet"
          disabled={index === pictures.length - 1}
          onClick={() => setIndex(index + 1)}
          aria-label="次の画像"
        >
          次の画像
          <ArrowRight />
        </button>
      </footer>
    </dialog>
  );
}

export function ArticleImages({ pictures }: { pictures: Picture[] }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const current = Math.min(index, pictures.length - 1);
  useEffect(() => {
    const images = [pictures[current - 1], pictures[current + 1]]
      .filter(Boolean)
      .map((p) => {
        const image = new Image();
        image.referrerPolicy = "no-referrer";
        image.src = p.url;
        return image;
      });
    return () => {
      images.forEach((image) => {
        image.src = "";
      });
    };
  }, [current, pictures]);
  if (current < 0) return null;
  const move = (delta: number) =>
    setIndex((i) => Math.max(0, Math.min(pictures.length - 1, i + delta)));
  return (
    <section
      className="article-gallery"
      aria-label="この記事の画像"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          move(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div
        className="article-gallery-stage"
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
        <figure>
          <Picture
            picture={pictures[current]}
            eager={current === 0}
            onOpen={() => setExpanded(current)}
          />
          <figcaption>
            {pictures[current].role === "cover"
              ? "記事の見出し画像"
              : "記事内の画像"}{" "}
            {current + 1} / {pictures.length}
          </figcaption>
        </figure>
      </div>
      {pictures.length > 1 && (
        <>
          <div className="photo-feature-navigation">
            <button
              className="button quiet"
              aria-label="記事の前の写真"
              disabled={current === 0}
              onClick={() => move(-1)}
            >
              <ArrowLeft size={18} />
              前の写真
            </button>
            <span aria-live="polite">
              {current + 1} / {pictures.length}
            </span>
            <button
              className="button quiet"
              aria-label="記事の次の写真"
              disabled={current === pictures.length - 1}
              onClick={() => move(1)}
            >
              次の写真
              <ArrowRight size={18} />
            </button>
          </div>
          <div
            className="photo-feature-thumbnails"
            role="group"
            aria-label="記事の写真一覧"
          >
            {pictures.map((picture, i) => (
              <button
                key={`${picture.url}:${i}`}
                aria-label={`記事の${i + 1}枚目を表示`}
                aria-pressed={current === i}
                onClick={() => setIndex(i)}
              >
                <img
                  src={picture.url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </button>
            ))}
          </div>
        </>
      )}
      {expanded !== null && (
        <ImageViewer
          pictures={pictures}
          initial={expanded}
          onClose={(selected) => {
            setIndex(selected);
            setExpanded(null);
          }}
        />
      )}
    </section>
  );
}
