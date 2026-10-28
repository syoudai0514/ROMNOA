import { ArrowDownUp } from "lucide-react";
import type { Sort } from "../lib/model";

export function SortControl({
  sort,
  onChange,
  popular,
  popularityUnavailable = false,
}: {
  sort: Sort;
  onChange: (value: Sort) => void;
  popular?: "source" | "bookmarks";
  popularityUnavailable?: boolean;
}) {
  return (
    <label className="sort-control">
      <ArrowDownUp size={14} aria-hidden="true" />
      <select
        aria-label="記事の並び順"
        value={sort}
        onChange={(e) => onChange(e.target.value as Sort)}
      >
        <option value="newest">新着順</option>
        <option value="unread">未読優先</option>
        <option value="category">カテゴリ別</option>
        {popular && (
          <option value="popular" disabled={popularityUnavailable}>
            {popular === "source"
              ? "人気順（サイト別）"
              : "人気順（ブックマーク数）"}
          </option>
        )}
      </select>
    </label>
  );
}
