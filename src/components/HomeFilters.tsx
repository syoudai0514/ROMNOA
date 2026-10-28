import { SlidersHorizontal } from "lucide-react";
import { categories, type Category, type Sort } from "../lib/model";
import { DateFilter } from "./DateFilter";
import { SortControl } from "./SortControl";

export function CategoryChips({
  category,
  onChange,
}: {
  category: Category;
  onChange: (category: Category) => void;
}) {
  return (
    <div className="category-chips" aria-label="カテゴリで絞り込み">
      {categories.map((c) => (
        <button
          key={c}
          className={category === c ? "selected" : ""}
          aria-pressed={category === c}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export function HomeFilters({
  category,
  onCategory,
  date,
  onDate,
  sort,
  onSort,
}: {
  category: Category;
  onCategory: (value: Category) => void;
  date: string;
  onDate: (value: string) => void;
  sort: Sort;
  onSort: (value: Sort) => void;
}) {
  return (
    <details className="home-filters" data-testid="home-filters">
      <summary>
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span>カテゴリ・日付</span>
        {(category !== "すべて" || date) && (
          <small>
            {[category !== "すべて" ? category : "", date]
              .filter(Boolean)
              .join(" · ")}
          </small>
        )}
      </summary>
      <CategoryChips category={category} onChange={onCategory} />
      <DateFilter key={date} date={date} onChange={onDate} />
      <SortControl sort={sort} onChange={onSort} popular="source" />
    </details>
  );
}
