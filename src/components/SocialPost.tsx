import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { socialPostSchema, type SocialPost } from "../lib/social-model";
import { ImageViewer } from "./ArticleImages";

// Shows an X / Instagram post's own photos and videos inside the app, read from
// the networks' public embed data on the server. No login, SDK or iframe.
export function SocialPostCard({
  url,
  provider,
}: {
  url: string;
  provider: "X" | "Instagram";
}) {
  const [post, setPost] = useState<SocialPost | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [still] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void (async () => {
      try {
        const res = await fetch(`/api/social?${new URLSearchParams({ url })}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw Error("unavailable");
        const parsed = socialPostSchema.safeParse(await res.json());
        if (!parsed.success || parsed.data.url !== url) throw Error("invalid");
        setPost(parsed.data);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [url, attempt]);
  const photos = post?.media.filter((m) => m.type === "photo") || [];
  const open = (
    <a
      className="text-button"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {provider}で開く
      <ExternalLink size={14} />
    </a>
  );
  return (
    <section
      className="social-post"
      aria-label={`${provider}の投稿${post?.handle ? ` @${post.handle}` : ""}`}
    >
      <header>
        <strong>{provider}</strong>
        {post && (
          <span>
            {post.author}
            {post.handle && ` @${post.handle}`}
          </span>
        )}
      </header>
      {!post && !failed && (
        <p className="yahoo-note" role="status">
          投稿を読み込み中…
        </p>
      )}
      {failed && (
        <p className="yahoo-note" role="alert">
          投稿を表示できませんでした（削除・非公開の可能性があります）。
          <button
            className="text-button"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RefreshCw size={14} />
            再読み込み
          </button>
        </p>
      )}
      {post?.text && <p className="social-post-text">{post.text}</p>}
      {!!post?.media.length && (
        <div
          className={`social-post-media count-${Math.min(post.media.length, 4)}`}
        >
          {post.media.map((m, i) =>
            m.type === "photo" ? (
              <button
                key={m.url}
                aria-label={`投稿の写真${photos.indexOf(m) + 1}を拡大`}
                onClick={() => setZoom(photos.indexOf(m))}
              >
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </button>
            ) : (
              <video
                key={`${m.url}:${i}`}
                src={m.url}
                poster={m.poster}
                controls={m.type === "video" || still}
                playsInline
                muted={m.type === "gif"}
                loop={m.type === "gif"}
                autoPlay={m.type === "gif" && !still}
                preload="metadata"
              />
            ),
          )}
        </div>
      )}
      <footer>{open}</footer>
      {zoom !== null && (
        <ImageViewer
          pictures={photos.map((p, i) => ({
            url: p.url,
            alt: `${provider}の投稿の写真${i + 1}`,
          }))}
          initial={zoom}
          onClose={() => setZoom(null)}
        />
      )}
    </section>
  );
}
