import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { japanDay, shiftDay, validDay } from "../lib/discovery-model";

export function DateFilter({
  date,
  onChange,
}: {
  date: string;
  onChange: (day: string) => void;
}) {
  const [draft, setDraft] = useState(date);
  const today = japanDay();
  return (
    <section className="date-filter" aria-label="掲載日で絞り込み">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (validDay(draft)) onChange(draft);
        }}
      >
        <label htmlFor="publication-date">
          <CalendarDays size={15} />
          掲載日
        </label>
        <input
          id="publication-date"
          type="date"
          min="2005-01-01"
          max={today}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          required
        />
        <button className="button secondary" disabled={!validDay(draft)}>
          表示
        </button>
      </form>
      <div className="date-shortcuts">
        {date ? (
          <>
            <button
              className="button quiet"
              aria-label="前の日"
              disabled={date <= "2005-01-01"}
              onClick={() => onChange(shiftDay(date, -1))}
            >
              <ChevronLeft size={16} />
              前の日
            </button>
            <button
              className="button quiet"
              aria-label="次の日"
              disabled={date >= today}
              onClick={() => onChange(shiftDay(date, 1))}
            >
              次の日
              <ChevronRight size={16} />
            </button>
            <button className="text-button" onClick={() => onChange("")}>
              日付を解除
            </button>
          </>
        ) : (
          <>
            <button className="text-button" onClick={() => onChange(today)}>
              今日
            </button>
            <button
              className="text-button"
              onClick={() => onChange(shiftDay(today, -1))}
            >
              昨日
            </button>
            <span>日本時間</span>
          </>
        )}
      </div>
    </section>
  );
}
