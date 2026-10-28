import { useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  japanDay,
  shiftDay,
  shiftMonth,
  validDay,
} from "../lib/discovery-model";

function DatePicker({
  value,
  onSelect,
  onClose,
}: {
  value: string;
  onSelect: (day: string) => void;
  onClose: () => void;
}) {
  const today = japanDay();
  const [month, setMonth] = useState(
    (validDay(value) ? value : today).slice(0, 7),
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const [year, mo] = month.split("-").map(Number);
  const offset = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const days = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  return (
    <dialog
      ref={dialog}
      className="date-picker"
      aria-label="掲載日を選ぶ"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">READ BACK IN TIME</span>
          <h2>掲載日を選ぶ</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="カレンダーを閉じる"
        >
          <X size={20} />
        </button>
      </header>
      <div className="calendar-month">
        <button
          className="icon-button"
          disabled={month <= "2005-01"}
          aria-label="前の月"
          onClick={() => setMonth(shiftMonth(`${month}-01`, -1).slice(0, 7))}
        >
          <ChevronLeft size={20} />
        </button>
        <label>
          <span className="sr-only">年</span>
          <select
            aria-label="年"
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value);
              setMonth(
                `${y}-${String(Math.min(mo, y === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 12)).padStart(2, "0")}`,
              );
            }}
          >
            {Array.from(
              { length: Number(today.slice(0, 4)) - 2004 },
              (_, i) => Number(today.slice(0, 4)) - i,
            ).map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">月</span>
          <select
            aria-label="月"
            value={mo}
            onChange={(e) =>
              setMonth(`${year}-${e.target.value.padStart(2, "0")}`)
            }
          >
            {Array.from(
              {
                length:
                  year === Number(today.slice(0, 4))
                    ? Number(today.slice(5, 7))
                    : 12,
              },
              (_, i) => i + 1,
            ).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          disabled={month >= today.slice(0, 7)}
          aria-label="次の月"
          onClick={() => setMonth(shiftMonth(`${month}-01`, 1).slice(0, 7))}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="calendar-grid" aria-label={`${year}年${mo}月`}>
        {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
          <span className="weekday" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              key={day}
              disabled={day > today}
              aria-label={`${year}年${mo}月${i + 1}日`}
              aria-pressed={day === value}
              className={day === today ? "is-today" : ""}
              onClick={() => onSelect(day)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <p>年・月を切り替えて、過去の記事も探せます。</p>
    </dialog>
  );
}

export function DateFilter({
  date,
  onChange,
}: {
  date: string;
  onChange: (day: string) => void;
}) {
  const [draft, setDraft] = useState(date);
  const [calendar, setCalendar] = useState(false);
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
          onChange={(e) => setDraft(e.target.value)}
          required
        />
        <button
          type="button"
          className="icon-button date-calendar-open"
          onClick={() => setCalendar(true)}
          aria-label="年・月から日付を選ぶ"
        >
          <CalendarDays size={19} />
        </button>
        <button className="button secondary" disabled={!validDay(draft)}>
          表示
        </button>
      </form>
      <div className="date-presets">
        {[
          [today, "今日"],
          [shiftDay(today, -1), "昨日"],
          [shiftDay(today, -7), "1週間前"],
          [shiftMonth(today, -1), "1か月前"],
          [shiftMonth(today, -12), "1年前"],
        ].map(([day, label]) => (
          <button
            key={label}
            aria-pressed={day === date}
            onClick={() => onChange(day)}
          >
            {label}
          </button>
        ))}
      </div>
      {date ? (
        <div className="date-shortcuts">
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
        </div>
      ) : (
        <p className="date-help">
          <button className="text-button" onClick={() => setCalendar(true)}>
            もっと前の日付を選ぶ
          </button>
          <span>日本時間</span>
        </p>
      )}
      {calendar && (
        <DatePicker
          value={draft}
          onClose={() => setCalendar(false)}
          onSelect={(day) => {
            setCalendar(false);
            setDraft(day);
            onChange(day);
          }}
        />
      )}
    </section>
  );
}
