import { Search, X, ArrowUpRight } from "lucide-react";
import { validSearch, type SearchScope } from "../lib/search-model";

export function ArticleSearch({
  query,
  active,
  scope,
  onScope,
  onQuery,
  onSubmit,
  onClear,
  onLocal,
}: {
  query: string;
  active: string;
  scope: SearchScope;
  onScope: (scope: SearchScope) => void;
  onQuery: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onLocal: () => void;
}) {
  return (
    <section className="article-search" aria-label="記事を探す">
      <form
        className="search-box search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (validSearch(query)) onSubmit();
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          placeholder="気になる名前・キーワードを検索"
          aria-label="記事を検索"
          value={query}
          maxLength={80}
          onChange={(e) => onQuery(e.target.value)}
          enterKeyHint="search"
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="検索をクリア"
            onClick={onClear}
          >
            <X size={16} />
          </button>
        )}
        <button className="search-submit" disabled={!validSearch(query)}>
          検索
        </button>
      </form>
      <fieldset className="search-target">
        <legend>検索対象</legend>
        <label>
          <input
            type="radio"
            name="search-scope"
            value="title"
            checked={scope === "title"}
            onChange={() => onScope("title")}
          />
          タイトルのみ
        </label>
        <label>
          <input
            type="radio"
            name="search-scope"
            value="body"
            checked={scope === "body"}
            onChange={() => onScope("body")}
          />
          本文を含む
        </label>
        <p>
          おすすめ・関連記事リンクは対象外。本文を含む検索は確認に時間がかかります。
        </p>
      </fieldset>
      <div className="search-scope">
        {active ? (
          <>
            <span>過去記事から「{active}」を検索中</span>
            <button className="text-button" onClick={onLocal}>
              一覧に戻る
            </button>
          </>
        ) : (
          <>
            <span>入力中はこの一覧のタイトルを絞り込みます</span>
            {validSearch(query) ? (
              <button className="text-button" onClick={onSubmit}>
                過去の記事も検索
                <ArrowUpRight size={13} />
              </button>
            ) : (
              <span>「検索」で過去記事も探せます</span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
