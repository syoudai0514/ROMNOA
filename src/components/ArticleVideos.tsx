import { useEffect, useState } from "react";
import type { ReaderVideo } from "../lib/reader-media";

function Clip({
  video,
  index,
  onElement,
}: {
  video: ReaderVideo;
  index: number;
  onElement: (url: string, element: HTMLVideoElement | null) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return (
    <figure className="article-video">
      {failed ? (
        <div className="reader-image-placeholder" role="status">
          <p>
            この動画を再生できませんでした。削除・公開制限・対応形式を投稿元で確認してください。
          </p>
          <button
            className="button secondary"
            onClick={() => {
              setFailed(false);
              setRetry((n) => n + 1);
            }}
          >
            動画を再読み込み
          </button>
        </div>
      ) : (
        <video
          key={retry}
          ref={(element) => onElement(video.url, element)}
          src={video.url}
          controls
          playsInline
          preload="metadata"
          muted={video.animated}
          loop={video.animated}
          autoPlay={video.animated && !reducedMotion}
          aria-label={`記事内の動画 ${index + 1}`}
          tabIndex={0}
          onError={() => setFailed(true)}
        />
      )}
      <figcaption>
        {video.animated ? "アニメーション" : "動画"} {index + 1} ·
        この画面で再生できます
      </figcaption>
    </figure>
  );
}

export function ArticleVideos({
  videos,
  onElement,
}: {
  videos: ReaderVideo[];
  onElement: (url: string, element: HTMLVideoElement | null) => void;
}) {
  return (
    <section className="article-videos" aria-label="この記事の動画">
      {videos.map((video, index) => (
        <Clip
          key={video.url}
          video={video}
          index={index}
          onElement={onElement}
        />
      ))}
    </section>
  );
}
