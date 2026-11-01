import { useEffect, useState } from "react";
import { ExternalLink, Lightbulb, MessageCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  yahooCommentsSchema,
  yahooCommentsUrl,
  type YahooComment,
  type YahooCommentOrder,
} from "../lib/yahoo-comments-model";

type State = {
  key: string;
  comments: YahooComment[];
  page: number;
  pages: number;
  total: number;
  totalWithReplies: number;
  closed: boolean;
};

// Yahoo! News comments for the open article, read through ROMNOA's API so the
// comment page's ads, rankings and recommendations are never loaded.
export function YahooComments({ articleId }: { articleId: string }) {
  const [order, setOrder] = useState<YahooCommentOrder>("recommended");
  const [state, setState] = useState<State | null>(null);
  const [request, setRequest] = useState({ page: 1, attempt: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const key = `${order}:${articleId}`;
  const current = state?.key === key ? state : null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const res = await fetch(
          `/api/yahoo-comments?${new URLSearchParams({
            article: articleId,
            page: String(request.page),
            order,
          })}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw Error("comments_unavailable");
        const value = yahooCommentsSchema.parse(await res.json());
        if (value.article !== articleId || value.order !== order)
          throw Error("comments_mismatch");
        if (controller.signal.aborted) return;
        setState((old) => {
          const base = old?.key === key && request.page > 1 ? old.comments : [];
          const seen = new Set(base.map((c) => c.id));
          return {
            key,
            comments: [...base, ...value.comments.filter((c) => !seen.has(c.id))],
            page: value.page,
            pages: value.pages,
            total: value.total,
            totalWithReplies: value.totalWithReplies,
            closed: !!value.closed,
          };
        });
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // Order changes always reset the request, so the request alone drives loading.
  }, [request]);

  const heading = current
    ? current.closed
      ? "コメント"
      : `コメント ${current.totalWithReplies.toLocaleString("ja-JP")}件`
    : "コメント";
  return (
    <section className="yahoo-comments" aria-label="Yahoo!ニュースのコメント">
      <div className="yahoo-comments-head">
        <h2>
          <MessageCircle size={16} aria-hidden="true" />
          {heading}
        </h2>
        {!current?.closed && (
          <div className="segmented" role="group" aria-label="コメントの並び順">
            {(
              [
                ["recommended", "おすすめ順"],
                ["newer", "新着順"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={order === value ? "selected" : ""}
                aria-pressed={order === value}
                onClick={() => {
                  if (value === order) return;
                  setOrder(value);
                  setRequest({ page: 1, attempt: 0 });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {current?.closed && (
        <p className="yahoo-note">この記事はコメントを受け付けていません。</p>
      )}
      {current && !current.closed && !current.comments.length && !loading && (
        <p className="yahoo-note">まだコメントはありません。</p>
      )}
      {!!current?.comments.length && (
        <ol className="yahoo-comment-list">
          {current.comments.map((c) => (
            <li
              key={`${c.kind}:${c.id}`}
              className={c.kind === "expert" ? "expert" : undefined}
            >
              <p className="yahoo-comment-meta">
                <strong>{c.name}</strong>
                {c.kind === "expert" && (
                  <span className="yahoo-comment-badge">専門家</span>
                )}
                {c.postedAt && <span>{c.postedAt}</span>}
              </p>
              {c.title && <p className="yahoo-comment-title">{c.title}</p>}
              <p className="yahoo-comment-text">{c.text}</p>
              <p className="yahoo-comment-reactions">
                <span aria-label={`共感した ${c.empathy}`}>
                  <ThumbsUp size={13} aria-hidden="true" />
                  {c.empathy.toLocaleString("ja-JP")}
                </span>
                {c.kind === "user" && (
                  <>
                    <span aria-label={`なるほど ${c.insight}`}>
                      <Lightbulb size={13} aria-hidden="true" />
                      {c.insight.toLocaleString("ja-JP")}
                    </span>
                    <span aria-label={`うーん ${c.negative}`}>
                      <ThumbsDown size={13} aria-hidden="true" />
                      {c.negative.toLocaleString("ja-JP")}
                    </span>
                  </>
                )}
                {c.replies > 0 && <span>返信 {c.replies}件</span>}
              </p>
            </li>
          ))}
        </ol>
      )}
      {loading && (
        <p className="yahoo-note" role="status">
          コメントを読み込み中…
        </p>
      )}
      {error && !loading && (
        <p className="yahoo-note" role="status">
          コメントを取得できませんでした。
          <button
            className="text-button"
            onClick={() =>
              setRequest((r) => ({ page: r.page, attempt: r.attempt + 1 }))
            }
          >
            再取得
          </button>
        </p>
      )}
      {current && !loading && !error && current.page < current.pages && (
        <button
          className="button quiet yahoo-comments-more"
          onClick={() => setRequest({ page: current.page + 1, attempt: 0 })}
        >
          さらにコメントを読む（{current.page + 1} / {current.pages}ページ）
        </button>
      )}
      {current && !current.closed && (
        <p className="yahoo-note">
          Yahoo!ニュースのコメントを広告なしで表示しています。返信の閲覧・投稿・評価はYahoo!ニュースで行えます（広告が表示される場合があります）。{" "}
          <a
            href={yahooCommentsUrl(articleId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Yahoo!で開く
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </p>
      )}
    </section>
  );
}
