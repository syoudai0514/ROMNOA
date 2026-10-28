import { Search, X, ArrowUpRight } from "lucide-react";
import { validSearch } from "../lib/search-model";

export function ArticleSearch({
  query,
  active,
  onQuery,
  onSubmit,
  onClear,
  onLocal,
}: {
  query: string;
  active: string;
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
            <span>入力するとこの一覧を絞り込みます</span>
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
