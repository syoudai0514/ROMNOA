import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ExternalLink,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { z } from "zod";
import { articleDate } from "../lib/model";
import {
  filterYahoo,
  yahooCategories,
  yahooArticleSchema,
  yahooResponseSchema,
  type YahooArticle,
  type YahooResponse,
} from "../lib/yahoo-model";
import { ArticleImages } from "./ArticleImages";

const STORE = "romnoa:yahoo-library:v1";
const FEED = "romnoa:yahoo-feed:v1";
const DAY = 86_400_000;
const librarySchema = z.object({
  saved: z.array(yahooArticleSchema).max(200),
  read: z
    .record(z.string().max(200), z.number().finite())
    .refine((r) => Object.keys(r).length <= 1000),
});
type Library = z.infer<typeof librarySchema>;
function readLibrary(): { value: Library; warning: string } {
  try {
    const raw = localStorage.getItem(STORE);
    return {
      value: raw
        ? librarySchema.parse(JSON.parse(raw))
        : { saved: [], read: {} },
      warning: "",
    };
  } catch {
    return {
      value: { saved: [], read: {} },
      warning: "Yahooニュースの保存データを読み込めませんでした。",
    };
  }
}
function cachedFeed(): YahooResponse | null {
  try {
    const value = yahooResponseSchema.parse(
      JSON.parse(localStorage.getItem(FEED) || "null"),
    );
    const age = Date.now() - Date.parse(value.generatedAt);
    return age >= -60_000 && age <= DAY ? value : null;
  } catch {
    return null;
  }
}

export function YahooNews({
  active,
  mode,
  onSearch,
  ngWords,
}: {
  active: boolean;
  mode: "home" | "search" | "saved";
  onSearch: () => void;
  ngWords: string[];
}) {
  const [initial] = useState(readLibrary);
  const [library, setLibrary] = useState(initial.value);
  const libraryRef = useRef(library);
  const [notice, setNotice] = useState(initial.warning);
  const [data, setData] = useState<YahooResponse | null>(cachedFeed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offlineCache, setOfflineCache] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<"title" | "summary">("title");
  const [category, setCategory] = useState("all");
  const [selection, setSelection] = useState<{
    article: YahooArticle;
    sequence: YahooArticle[];
  } | null>(null);
  const [trail, setTrail] = useState<YahooArticle[]>([]);
  useEffect(() => {
    // History deletion in Settings also applies to this separate RSS library.
    const clear = () => {
      const next = { ...libraryRef.current, read: {} };
      libraryRef.current = next;
      setLibrary(next);
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        setNotice("既読の削除を端末に保存できませんでした。");
      }
    };
    window.addEventListener("romnoa:clear-read", clear);
    return () => window.removeEventListener("romnoa:clear-read", clear);
  }, []);
  useEffect(() => {
    if (!active) {
      setSelection(null);
      setTrail([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/yahoo", { signal: controller.signal });
        if (!res.ok) throw new Error("fetch_failed");
        const result = yahooResponseSchema.parse(await res.json());
        if (!live) return;
        setData(result);
        setOfflineCache(false);
        try {
          localStorage.setItem(FEED, JSON.stringify(result));
        } catch {
          setNotice(
            "ニュース一覧を端末に保存できませんでした。オフラインでは利用できない場合があります。",
          );
        }
      } catch {
        if (!live) return;
        const cached = cachedFeed();
        if (cached) {
          setData(cached);
          setOfflineCache(true);
        }
        setError(
          cached
            ? "取得に失敗したため、端末に残っているニュースを表示しています。"
            : "Yahooニュースを取得できませんでした。保存したニュースは引き続き開けます。",
        );
      } finally {
        clearTimeout(timeout);
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [active, refresh]);
  function update(next: Library) {
    libraryRef.current = next;
    setLibrary(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      setNotice(
        "変更を端末に保存できませんでした。再起動すると失われる場合があります。",
      );
    }
  }
  function mark(article: YahooArticle) {
    const entries = Object.entries({
      ...libraryRef.current.read,
      [article.id]: Date.now(),
    })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1000);
    update({ ...libraryRef.current, read: Object.fromEntries(entries) });
  }
  function save(article: YahooArticle) {
    const old = libraryRef.current;
    if (old.saved.some((a) => a.id === article.id))
      update({ ...old, saved: old.saved.filter((a) => a.id !== article.id) });
    else if (old.saved.length < 200)
      update({ ...old, saved: [article, ...old.saved] });
    else
      setNotice(
        "Yahooニュースの保存は200件までです。不要な保存を解除してください。",
      );
  }
  const allowed = (a: YahooArticle) =>
    !ngWords.some((w) =>
      a.title
        .normalize("NFKC")
        .toLowerCase()
        .includes(w.normalize("NFKC").toLowerCase()),
    );
  const articles = useMemo(
    () =>
      filterYahoo(
        mode === "saved" ? library.saved : data?.articles || [],
        mode === "search" ? term : "",
        scope,
        category,
      ).filter(allowed),
    [data, library.saved, mode, term, scope, category, ngWords],
  );
  const saved = new Set(library.saved.map((a) => a.id));
  function open(article: YahooArticle, sequence = articles) {
    mark(article);
    setTrail([]);
    setSelection({ article, sequence });
  }
  if (!active) return null;
  return (
    <section className="yahoo-panel" aria-label="Yahooニュース">
      <div className="yahoo-controls">
        <span>{mode === "saved" ? "保存したニュース" : "新着ニュース"}</span>
        <div>
          {mode !== "search" && (
            <button className="text-button" onClick={onSearch}>
              <Search size={16} />
              ニュースを検索
            </button>
          )}
          <button
            className={`icon-button ${loading ? "refreshing" : ""}`}
            aria-label="Yahooニュースを更新"
            disabled={loading}
            onClick={() => setRefresh((r) => r + 1)}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      {mode === "search" && (
        <form
          className="yahoo-search"
          role="search"
          aria-label="Yahooニュースを探す"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(query.trim());
          }}
        >
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Yahooニュースの検索語"
              type="search"
              maxLength={80}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value) setTerm("");
              }}
              placeholder="ニュースのキーワード"
            />
            <button type="submit" className="button primary">
              検索
            </button>
          </div>
          <fieldset>
            <legend>検索対象</legend>
            <label>
              <input
                type="radio"
                name="yahoo-scope"
                checked={scope === "title"}
                onChange={() => setScope("title")}
              />
              タイトルのみ
            </label>
            <label>
              <input
                type="radio"
                name="yahoo-scope"
                checked={scope === "summary"}
                onChange={() => setScope("summary")}
              />
              配信された概要を含む
            </label>
          </fieldset>
          <p className="yahoo-note">
            日付で絞らず、取得済みの全9カテゴリ・最大450件を検索します。過去記事・全文は検索対象に含まれません。
          </p>
          {term && (
            <a
              className="text-button"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://news.yahoo.co.jp/search?p=${encodeURIComponent(term)}`}
            >
              過去記事をYahoo!ニュースで検索
              <ExternalLink size={14} />
            </a>
          )}
        </form>
      )}
      <div
        className="category-chips yahoo-categories"
        role="group"
        aria-label="ニュースのカテゴリ"
      >
        {[{ id: "all", label: "すべて" }, ...yahooCategories].map((c) => (
          <button
            key={c.id}
            className={category === c.id ? "selected" : ""}
            aria-pressed={category === c.id}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {notice && (
        <p role="alert" className="status-banner warning">
          {notice}
          <button
            className="icon-button"
            aria-label="Yahooニュースの通知を閉じる"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </p>
      )}
      {error && (
        <p role="status" className="status-banner warning">
          {error}
          <button
            className="text-button"
            disabled={loading}
            onClick={() => setRefresh((r) => r + 1)}
          >
            再試行
          </button>
        </p>
      )}
      {data?.sources.some((s) => s.status !== "ok") && (
        <p className="yahoo-note" role="status">
          {data.sources
            .filter((s) => s.status !== "ok")
            .map(
              (s) =>
                `${yahooCategories.find((c) => c.id === s.id)?.label}：${s.status === "cached" ? "前回の配信" : "取得できません"}`,
            )
            .join(" ／ ")}
        </p>
      )}
      <p className="yahoo-note">
        公式RSSの画像・記事冒頭を広告なしで表示します。本文の続きは元記事で読めます（広告が出る場合があります）。
      </p>
      <div className="yahoo-result-heading" role="status">
        <strong>
          {term && mode === "search"
            ? `「${term}」の検索結果`
            : mode === "saved"
              ? "保存したニュース"
              : "配信中のニュース"}{" "}
          <span className="count-badge">{articles.length}</span>
        </strong>
        {loading && <span>更新中…</span>}
      </div>
      <div className="article-list yahoo-list">
        {articles.map((a) => (
          <article
            className={`article-row ${library.read[a.id] ? "is-read" : ""}`}
            key={a.id}
            data-testid="yahoo-row"
          >
            <button
              className="article-open"
              aria-label={`ニュースを開く: ${a.title}`}
              onClick={() => open(a)}
            >
              <h3>{a.title}</h3>
              <span className="article-meta">
                <span>
                  {yahooCategories.find((c) => c.id === a.category)?.label}
                </span>
                <span>Yahoo!ニュース</span>
                <time dateTime={a.publishedAt || undefined}>
                  {articleDate(a.publishedAt)}
                </time>
                {library.read[a.id] && (
                  <span className="read-label">
                    <Check size={12} />
                    既読
                  </span>
                )}
              </span>
            </button>
            <button
              className={`icon-button save-button ${saved.has(a.id) ? "is-saved" : ""}`}
              aria-label={`${saved.has(a.id) ? "ニュースの保存を解除" : "ニュースを保存"}: ${a.title}`}
              aria-pressed={saved.has(a.id)}
              onClick={() => save(a)}
            >
              <Bookmark
                size={19}
                fill={saved.has(a.id) ? "currentColor" : "none"}
              />
            </button>
          </article>
        ))}
      </div>
      {!loading && !articles.length && (
        <p className="yahoo-empty">
          {mode === "saved"
            ? "保存したYahooニュースはまだありません。"
            : "この条件に一致するニュースはありません。カテゴリや検索語を変えてください。"}
        </p>
      )}
      {data && (
        <p className="yahoo-note">
          {offlineCache ? "端末キャッシュ · " : ""}
          {articleDate(data.generatedAt)} 更新 · 配信元：Yahoo!ニュース公式RSS
        </p>
      )}
      {selection && (
        <YahooReader
          key={selection.article.id}
          article={selection.article}
          saved={saved.has(selection.article.id)}
          related={(data?.articles || [])
            .filter(
              (a) =>
                a.id !== selection.article.id &&
                a.category === selection.article.category &&
                allowed(a),
            )
            .slice(0, 12)}
          index={selection.sequence.findIndex(
            (a) => a.id === selection.article.id,
          )}
          total={selection.sequence.length}
          onClose={() => {
            setSelection(null);
            setTrail([]);
          }}
          onSave={() => save(selection.article)}
          onMove={(delta) => {
            const a =
              selection.sequence[
                selection.sequence.findIndex(
                  (a) => a.id === selection.article.id,
                ) + delta
              ];
            if (a) {
              mark(a);
              setTrail([]);
              setSelection({ ...selection, article: a });
            }
          }}
          onRelated={(a) => {
            mark(a);
            setTrail((t) => [...t, selection.article].slice(-50));
            setSelection({ ...selection, article: a });
          }}
          onBack={
            trail.length
              ? () => {
                  const a = trail[trail.length - 1];
                  setTrail((t) => t.slice(0, -1));
                  setSelection({ ...selection, article: a });
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function YahooReader({
  article,
  saved,
  related,
  index,
  total,
  onClose,
  onSave,
  onMove,
  onRelated,
  onBack,
}: {
  article: YahooArticle;
  saved: boolean;
  related: YahooArticle[];
  index: number;
  total: number;
  onClose: () => void;
  onSave: () => void;
  onMove: (delta: number) => void;
  onRelated: (article: YahooArticle) => void;
  onBack?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    let y = 0;
    const key = `romnoa:yahoo-position:${article.id}`;
    try {
      y = Math.max(0, Number(sessionStorage.getItem(key)) || 0);
    } catch {
      /* optional */
    }
    content.current!.scrollTop = y;
    let restore = y > 0;
    const node = content.current!;
    const observer = new ResizeObserver(() => {
      if (restore) node.scrollTop = y;
    });
    observer.observe(node.firstElementChild!);
    const finish = () => {
      restore = false;
    };
    node.addEventListener("touchstart", finish, { passive: true });
    node.addEventListener("wheel", finish, { passive: true });
    const timer = setTimeout(finish, 1500);
    return () => {
      try {
        sessionStorage.setItem(key, String(node.scrollTop));
      } catch {
        /* optional */
      }
      clearTimeout(timer);
      observer.disconnect();
      node.removeEventListener("touchstart", finish);
      node.removeEventListener("wheel", finish);
      element.close();
      document.body.style.overflow = previous;
    };
  }, [article.id]);
  return (
    <dialog
      ref={dialog}
      className="reader yahoo-reader"
      aria-labelledby="yahoo-reader-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="reader-inner">
        <header className="reader-toolbar">
          {onBack ? (
            <button className="button quiet reader-back" onClick={onBack}>
              <ArrowLeft size={17} />
              元のニュースへ戻る
            </button>
          ) : (
            <span className="eyebrow">ROMNOA / NEWS</span>
          )}
          <button
            className="icon-button"
            aria-label="ニュースを閉じる"
            onClick={onClose}
            autoFocus
          >
            <X size={21} />
          </button>
        </header>
        <div className="reader-content" ref={content}>
          <div>
            {article.image && (
              <ArticleImages
                pictures={[
                  { url: article.image, alt: article.title, role: "cover" },
                ]}
              />
            )}
            <span className="pill">
              {yahooCategories.find((c) => c.id === article.category)?.label}
            </span>
            <h1 id="yahoo-reader-title">{article.title}</h1>
            <p className="reader-byline">
              Yahoo!ニュース · {articleDate(article.publishedAt)}
            </p>
            <section
              className="reading-body yahoo-summary"
              aria-label="配信された記事冒頭"
            >
              <p className="reader-text-block">
                {article.summary ||
                  "このニュースには記事冒頭の配信がありません。"}
              </p>
            </section>
            <p className="yahoo-note">
              ここまでが公式RSSで配信された記事冒頭です。全文は元記事でご確認ください。
            </p>
            <div className="reader-actions">
              <a
                className="button primary"
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                本文の続きを元記事で読む
                <ExternalLink size={16} />
              </a>
              <button
                className="button quiet"
                aria-pressed={saved}
                onClick={onSave}
              >
                <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
                {saved ? "保存済み" : "あとで読む"}
              </button>
            </div>
            <p className="yahoo-note">
              元記事では広告が表示される場合があります。Safariでは対応する記事でページメニューからリーダー表示を利用できます。
            </p>
            {!!related.length && (
              <section
                className="yahoo-next-news"
                aria-label="同じカテゴリのニュース"
              >
                <h2>同じカテゴリのニュース</h2>
                <p className="yahoo-note">公式RSSで配信中のニュースです。</p>
                {related.map((a) => (
                  <button
                    className="yahoo-related"
                    key={a.id}
                    onClick={() => onRelated(a)}
                  >
                    <span>{a.title}</span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </section>
            )}
          </div>
        </div>
        <footer className="reader-footer">
          <button
            className="text-button"
            disabled={index <= 0}
            onClick={() => onMove(-1)}
          >
            <ArrowLeft size={18} />
            前のニュース
          </button>
          <span>{index >= 0 ? `${index + 1} / ${total}` : "関連ニュース"}</span>
          <button
            className="text-button"
            disabled={index < 0 || index >= total - 1}
            onClick={() => onMove(1)}
          >
            次のニュース
            <ArrowRight size={18} />
          </button>
        </footer>
      </div>
    </dialog>
  );
}
