import { useMemo, useState } from "react";
import { buildSavedTopics, matchesSavedTitle, type SavedTitle } from "./saved-topics";
export function useSavedTopics<T extends SavedTitle>(articles: T[], enabled: boolean) {
  const [selectedId, select] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const topics = useMemo(() => enabled ? buildSavedTopics(articles) : [], [articles, enabled]);
  const selected = topics.find((topic) => topic.id === selectedId) || null;
  const filtered = useMemo(() => enabled ? articles.filter((article) => (!selected || selected.articleIds.has(article.id)) && matchesSavedTitle(article.title, query)) : articles, [articles, enabled, selected, query]);
  return { topics, selected, select, query, setQuery, articles: filtered };
}
