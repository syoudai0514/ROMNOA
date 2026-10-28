import type { ReactNode } from "react";
import type { ReaderDocument } from "../lib/reader-model";
import { readerImageFromLink } from "../lib/reader-model";
import type { Article } from "../lib/model";

// Match only URLs/titles that the parser validated; never interpret article HTML.
export function ReaderText({
  text,
  links,
  sourceId,
  imageUrls,
  onImageOpen,
  articles,
  onArticleOpen,
}: {
  text: string;
  links: ReaderDocument["links"];
  sourceId: Article["sourceId"];
  imageUrls: string[];
  onImageOpen: (url: string) => void;
  articles: Article[];
  onArticleOpen: (article: Article) => void;
}) {
  const candidates = links.flatMap((link) =>
    [link.url, link.title]
      .filter((label) => label.length >= 4)
      .map((label) => ({ label, url: link.url })),
  );
  const byLabel = new Map(candidates.map((link) => [link.label, link.url]));
  if (!byLabel.size) return <>{text}</>;
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    labels
      .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "g",
  );
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let count = 0;
  while (count++ < 200 && (match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const url = byLabel.get(match[0])!;
    const image = readerImageFromLink(url, sourceId, imageUrls);
    const article = articles.find((candidate) => candidate.id === url);
    parts.push(
      image ? (
        imageUrls.includes(image) ? (
          <button
            key={match.index}
            className="inline-image-link"
            onClick={() => onImageOpen(image)}
          >
            画像{imageUrls.indexOf(image) + 1}を拡大
          </button>
        ) : (
          <span key={match.index}>表示対象外の画像</span>
        )
      ) : article ? (
        <button
          key={match.index}
          className="inline-image-link"
          onClick={() => onArticleOpen(article)}
        >
          {match[0]}
        </button>
      ) : (
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {match[0]}
          <span className="external-link-marker" aria-hidden="true">
            {" "}
            ↗
          </span>
        </a>
      ),
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
