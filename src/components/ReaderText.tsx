import type { ReactNode } from "react";
import type { ReaderDocument } from "../lib/reader-model";

// Match only URLs/titles that the parser validated; never interpret article HTML.
export function ReaderText({
  text,
  links,
}: {
  text: string;
  links: ReaderDocument["links"];
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
    parts.push(
      <a
        key={match.index}
        href={byLabel.get(match[0])}
        target="_blank"
        rel="noopener noreferrer"
      >
        {match[0]}
      </a>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
