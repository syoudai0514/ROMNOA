import { Bookmark, Check } from "lucide-react";
import { articleDate, sourceInfo, type Article } from "../lib/model";

export function ArticleRow({
  article,
  saved,
  read,
  onOpen,
  onSave,
  rank,
  bookmarks,
  local = false,
}: {
  article: Article;
  saved: boolean;
  read: boolean;
  onOpen: () => void;
  onSave: () => void;
  rank?: number;
  bookmarks?: number;
  local?: boolean;
}) {
  const source = sourceInfo.find((s) => s.id === article.sourceId)!;
  return (
    <article
      className={`article-row ${read ? "is-read" : ""}`}
      data-testid="article-row"
    >
      <button
        className="article-open"
        onClick={onOpen}
        aria-label={`記事を開く: ${article.title}`}
      >
        <h3>{article.title}</h3>
        <span className="article-meta">
          {rank !== undefined && (
            <span className="rank-label">
              <strong>{rank}位</strong>
            </span>
          )}
          {bookmarks !== undefined && (
            <span className="bookmark-metric" title="はてなブックマーク数">
              <span className="sr-only">はてなブックマーク </span>
              {bookmarks}件
            </span>
          )}
          <span className="article-source">
            <i
              className={`source-dot source-${source.id}`}
              aria-hidden="true"
            />
            <span>{source.name}</span>
          </span>
          <time dateTime={article.publishedAt || undefined}>
            {articleDate(article.publishedAt)}
          </time>
          {read && (
            <span className="read-label">
              <Check size={12} />
              既読
            </span>
          )}
          {local && (
            <span
              className="local-search-label"
              title="保存・履歴から見つかった記事"
            >
              端末
            </span>
          )}
        </span>
      </button>
      <button
        className={`icon-button save-button ${saved ? "is-saved" : ""}`}
        aria-label={
          saved ? `保存を解除: ${article.title}` : `保存する: ${article.title}`
        }
        aria-pressed={saved}
        onClick={onSave}
      >
        <Bookmark
          size={19}
          fill={saved ? "currentColor" : "none"}
          strokeWidth={1.6}
        />
      </button>
    </article>
  );
}
