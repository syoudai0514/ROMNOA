import { useState } from "react";
import { X, Plus, Star } from "lucide-react";
import { normalizeSearch, validSearch } from "../lib/search-model";
const KEY = "romnoa:my-search:v1";
function savedWords(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value)
      ? value
          .filter((w): w is string => typeof w === "string" && validSearch(w))
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function MySearch({
  onSearch,
  onClose,
}: {
  onSearch: (term: string) => void;
  onClose: () => void;
}) {
  const [words, setWords] = useState(savedWords);
  const [word, setWord] = useState("");
  const [warning, setWarning] = useState("");
  function update(next: string[]) {
    setWords(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setWarning("");
    } catch {
      setWarning("キーワードを端末に保存できませんでした。");
    }
  }
  return (
    <section className="my-search" aria-label="マイ検索">
      <header>
        <div>
          <span className="eyebrow">MY SEARCH</span>
          <h2>好きな名前から、探そう。</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="マイ検索を閉じる"
        >
          <X size={19} />
        </button>
      </header>
      <p>女優名や気になる言葉を登録して、過去の記事から探せます。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = normalizeSearch(word);
          if (validSearch(q) && !words.includes(q) && words.length < 20) {
            update([...words, q]);
            setWord("");
          }
        }}
      >
        <Star size={16} aria-hidden="true" />
        <input
          aria-label="マイ検索の登録語"
          placeholder="好きな女優名・キーワード"
          maxLength={80}
          value={word}
          onChange={(e) => setWord(e.target.value)}
        />
        <button
          className="icon-button"
          aria-label="キーワードを登録"
          disabled={
            !validSearch(word) ||
            words.includes(normalizeSearch(word)) ||
            words.length >= 20
          }
        >
          <Plus size={20} />
        </button>
      </form>
      <div className="my-search-words">
        {words.map((term) => (
          <div key={term}>
            <button onClick={() => onSearch(term)}>{term}</button>
            <button
              className="icon-button"
              onClick={() => update(words.filter((w) => w !== term))}
              aria-label={`登録語を削除: ${term}`}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <small>
        登録語はこの端末に保存。開いた記事は通常の閲覧履歴に残ります。
      </small>
      {warning && <p role="status">{warning}</p>}
    </section>
  );
}
