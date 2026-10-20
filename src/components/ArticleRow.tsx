import { Bookmark, Check, ChevronRight } from "lucide-react";
import { articleDate, sourceInfo, type Article } from "../lib/model";

export function ArticleRow({
  article,
  saved,
  read,
  onOpen,
  onSave,
}: {
  article: Article;
  saved: boolean;
  read: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const source = sourceInfo.find((s) => s.id === article.sourceId)!;
  return (
    <article
      className={`article-row ${read ? "is-read" : ""}`}
      data-testid="article-row"
    >
      <span
        className={`source-monogram source-${source.id}`}
        aria-hidden="true"
      >
        {source.short}
      </span>
      <button
        className="article-open"
        onClick={onOpen}
        aria-label={`記事を開く: ${article.title}`}
      >
        <span className="article-meta">
          <span className="category-label">{article.category}</span>
          <time dateTime={article.publishedAt || undefined}>
            {articleDate(article.publishedAt)}
          </time>
          {read && (
            <span className="read-label">
              <Check size={12} />
              既読
            </span>
          )}
        </span>
        <h3>{article.title}</h3>
        <span className="article-source">
          {source.name}
          <ChevronRight size={12} />
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
