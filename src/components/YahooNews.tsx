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
  yahooImageUrl,
  yahooResponseSchema,
  type YahooArticle,
  type YahooResponse,
} from "../lib/yahoo-model";
import { ArticleImages } from "./ArticleImages";
import { useYahooSearch } from "../lib/use-yahoo-search";
import { normalizeSearch, validSearch } from "../lib/search-model";
import { useYahooPhotos } from "../lib/use-yahoo-photos";
import type { PhotoFeature } from "../lib/yahoo-photos-model";
import { YahooPhotoFeature } from "./YahooPhotoFeature";
import { SocialPostCard } from "./SocialPost";
import { socialPostUrl } from "../lib/social-model";
import { linkedPhotoTarget } from "../lib/yahoo-photos-model";

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
  bottomNav,
  ngWords,
  category,
  onCategory,
}: {
  active: boolean;
  mode: "home" | "search" | "saved";
  onSearch: () => void;
  bottomNav?: React.ReactNode;
  ngWords: string[];
  category: string;
  onCategory: (category: string) => void;
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
  const [homeView, setHomeView] = useState<"topics" | "latest">("topics");
  const [topics, setTopics] = useState<YahooArticle[] | null>(null);
  const [topicsError, setTopicsError] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  useEffect(() => {
    if (category !== "all" && mode === "home") setHomeView("latest");
  }, [category, mode]);
  const [resultLimit, setResultLimit] = useState(50);
  const [savedOrder, setSavedOrder] = useState<"saved" | "date">("saved");
  const [scope, setScope] = useState<"title" | "summary">("title");
  const searchActive = active && mode === "search" && !!term;
  const remote = useYahooSearch(searchActive ? term : "", scope, resultLimit);
  const [selection, setSelection] = useState<{
    article: YahooArticle;
    sequence: YahooArticle[];
  } | null>(null);
  const [trail, setTrail] = useState<YahooArticle[]>([]);
  useEffect(() => {
    const close = () => {
      setSelection(null);
      setTrail([]);
    };
    window.addEventListener("romnoa:close-yahoo-reader", close);
    return () => window.removeEventListener("romnoa:close-yahoo-reader", close);
  }, []);
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
  useEffect(() => {
    if (!active || mode !== "home") return;
    const controller = new AbortController();
    setTopicsError(false);
    void fetch("/api/yahoo-topics", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("unavailable");
        const data = z
          .object({ articles: z.array(yahooArticleSchema).max(30) })
          .parse(await r.json());
        setTopics(data.articles);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTopicsError(true);
      });
    return () => controller.abort();
  }, [active, mode, refresh]);
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
        mode === "saved"
          ? library.saved
          : searchActive
            ? remote.data?.articles || []
            : mode === "home" && homeView === "topics"
              ? topics || []
              : data?.articles || [],
        "",
        scope,
        mode === "home" && homeView === "topics" ? "all" : category,
        searchActive ||
          (mode === "home" && homeView === "topics") ||
          (mode === "saved" && savedOrder === "saved"),
      )
        .filter(allowed)
        .filter((a) => !searchActive || !unreadOnly || !library.read[a.id]),
    [
      data,
      library.saved,
      library.read,
      unreadOnly,
      topics,
      homeView,
      savedOrder,
      mode,
      term,
      scope,
      category,
      ngWords,
      searchActive,
      remote.data,
    ],
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
        <span>
          {mode === "saved"
            ? "保存したニュース"
            : mode === "search"
              ? "Yahooニュースを検索"
              : "新着ニュース"}
        </span>
        <div>
          {mode !== "search" && (
            <button className="text-button" onClick={onSearch}>
              <Search size={16} />
              ニュースを検索
            </button>
          )}
          <button
            className={`icon-button ${(searchActive ? remote.searching : loading) ? "refreshing" : ""}`}
            aria-label="Yahooニュースを更新"
            disabled={searchActive ? remote.searching : loading}
            onClick={() =>
              searchActive ? remote.retry() : setRefresh((r) => r + 1)
            }
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
            const q = normalizeSearch(query);
            if (!validSearch(q)) return;
            setTerm(q);
            onCategory("all");
            remote.retry();
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
              タイトル・検索の抜粋
            </label>
          </fieldset>
          <label>
            取得する候補数{" "}
            <select
              aria-label="ニュースの検索候補数"
              value={resultLimit}
              onChange={(e) => setResultLimit(Number(e.target.value))}
            >
              <option value={50}>50件</option>
              <option value={100}>100件</option>
              <option value={200}>200件</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />{" "}
            未読のみ
          </label>
          <p className="yahoo-note">
            Yahoo掲載記事を期間指定なしで検索します。取得した候補から絞り込みます。
          </p>
          {term && (
            <a
              className="text-button"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://news.yahoo.co.jp/search?p=${encodeURIComponent(term)}`}
            >
              続きもYahoo!ニュースで検索
              <ExternalLink size={14} />
            </a>
          )}
        </form>
      )}
      {mode === "home" && (
        <div
          className="category-chips"
          role="group"
          aria-label="ニュースの表示"
        >
          <button
            className={homeView === "topics" ? "selected" : ""}
            aria-pressed={homeView === "topics"}
            onClick={() => setHomeView("topics")}
          >
            トピックス
          </button>
          <button
            className={homeView === "latest" ? "selected" : ""}
            aria-pressed={homeView === "latest"}
            onClick={() => setHomeView("latest")}
          >
            新着ニュース
          </button>
        </div>
      )}
      {mode === "home" && homeView === "topics" && topicsError && (
        <p className="status-banner warning" role="status">
          トピックスを取得できませんでした。更新をお試しください。
        </p>
      )}
      {mode === "saved" && (
        <label>
          並び順{" "}
          <select
            aria-label="保存したニュースの並び順"
            value={savedOrder}
            onChange={(e) => setSavedOrder(e.target.value as "saved" | "date")}
          >
            <option value="saved">保存した順</option>
            <option value="date">記事の日付順</option>
          </select>
        </label>
      )}
      {(mode !== "home" || homeView !== "topics") && (
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
              onClick={() => onCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
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
      {!searchActive && error && (
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
      {searchActive && remote.error && (
        <p className="status-banner warning" role="alert">
          {remote.error}
          <button className="text-button" onClick={remote.retry}>
            検索を再試行
          </button>
        </p>
      )}
      {searchActive && remote.data && (
        <details
          className="yahoo-note yahoo-search-range"
          open={remote.data.status === "cached"}
        >
          <summary>
            <span role="status">
              取得{remote.data.candidateCount}件 ／ Yahoo候補総数は
              {remote.data.providerTotal}件
            </span>
          </summary>
          <p>
            取得した先頭候補の見出し・検索抜粋で照合しています。Yahoo候補総数にはタイトル以外の一致も含み、表示中の一致数とは異なります。未取得の続きはYahooの検索画面で確認できます。本文全文の検索ではありません。
          </p>
          {remote.data.status === "cached" && (
            <p>取得に失敗したため前回の検索結果を表示しています。</p>
          )}
        </details>
      )}
      {!searchActive && data?.sources.some((s) => s.status !== "ok") && (
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
      {mode !== "search" && (
        <p className="yahoo-note">
          RSSの記事冒頭や、検索結果のサムネイル・抜粋を広告なしで表示します。本文の続きは元記事で読めます（広告が出る場合があります）。
        </p>
      )}
      <div className="yahoo-result-heading" role="status">
        <strong>
          {term && mode === "search"
            ? `「${term}」の検索結果`
            : mode === "saved"
              ? "保存したニュース"
              : mode === "home" && homeView === "topics"
                ? "トピックス"
                : "配信中のニュース"}{" "}
          <span className="count-badge">{articles.length}</span>
        </strong>
        {(searchActive ? remote.searching : loading) && (
          <span>{searchActive ? "Yahooを検索中…" : "更新中…"}</span>
        )}
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
              {a.image && (
                <img
                  className="yahoo-list-thumbnail"
                  src={a.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={(event) => {
                    event.currentTarget.style.visibility = "hidden";
                  }}
                />
              )}
              <div className="yahoo-list-copy">
                <h3>{a.title}</h3>
                <span className="article-meta">
                  <span>
                    {a.origin === "topic"
                      ? "トピックス"
                      : yahooCategories.find((c) => c.id === a.category)?.label}
                  </span>
                  <span>{a.provider || "Yahoo!ニュース"}</span>
                  <time dateTime={a.publishedAt || undefined}>
                    {a.displayDate || articleDate(a.publishedAt)}
                  </time>
                  {library.read[a.id] && (
                    <span className="read-label">
                      <Check size={12} />
                      既読
                    </span>
                  )}
                </span>
              </div>
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
      {!(searchActive ? remote.searching || remote.error : loading) &&
        !articles.length && (
          <p className="yahoo-empty">
            {mode === "saved"
              ? "保存したYahooニュースはまだありません。"
              : searchActive
                ? "取得した検索候補に一致するニュースはありません。検索対象・カテゴリを変えるか、Yahooで続きを確認してください。"
                : "この条件に一致するニュースはありません。カテゴリや検索語を変えてください。"}
          </p>
        )}
      {searchActive && remote.data && (
        <p className="yahoo-note">
          {articleDate(remote.data.fetchedAt)} 更新 · Yahoo!ニュース検索
        </p>
      )}
      {!searchActive && data && (
        <p className="yahoo-note">
          {offlineCache ? "端末キャッシュ · " : ""}
          {articleDate(data.generatedAt)} 更新 · 配信元：Yahoo!ニュース公式RSS
        </p>
      )}
      {selection && (
        <YahooReader
          key={selection.article.id}
          article={selection.article}
          bottomNav={bottomNav}
          saved={saved.has(selection.article.id)}
          related={[
            ...new Map(
              [
                ...(remote.data?.articles || []),
                ...(data?.articles || []),
                ...library.saved,
              ].map((a) => [a.id, a]),
            ).values(),
          ]
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
  bottomNav,
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
  bottomNav?: React.ReactNode;
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
  const photos = useRef<HTMLDivElement>(null);
  const featureSection = useRef<HTMLDivElement>(null);
  const newsHeading = useRef<HTMLHeadingElement>(null);
  const restoring = useRef(false);
  const [body, setBody] = useState<{
    article: string;
    pages: string[];
    complete: boolean;
    richPages?: {
      kind: "text" | "link" | "image" | "photo" | "social";
      text: string;
      url?: string;
    }[][];
  } | null>(null);
  const currentBody = body?.article === article.id ? body : null;
  const [bodyLoading, setBodyLoading] = useState(true);
  const [bodyAttempt, setBodyAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBody(null);
    setBodyLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/yahoo-body?${new URLSearchParams({ article: article.id })}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw Error("body_unavailable");
        const value = await res.json();
        if (
          value.article !== article.id ||
          !Array.isArray(value.pages) ||
          !value.pages.length ||
          value.pages.length > 10 ||
          value.pages.some(
            (p: unknown) => typeof p !== "string" || p.length > 100000,
          ) ||
          typeof value.complete !== "boolean"
        )
          throw Error("body_invalid");
        const richSchema = z
          .array(
            z
              .array(
                z
                  .object({
                    kind: z.enum(["text", "link", "image", "photo", "social"]),
                    text: z.string().max(10000),
                    url: z.string().max(2048).optional(),
                  })
                  .refine((p) => {
                    if (p.kind === "text") return true;
                    if (!p.url) return false;
                    if (p.kind === "image")
                      return yahooImageUrl(p.url) === p.url;
                    if (p.kind === "social")
                      return socialPostUrl(p.url)?.url === p.url;
                    try {
                      const u = new URL(p.url);
                      return (
                        ["https:", "http:"].includes(u.protocol) &&
                        !u.username &&
                        !u.password
                      );
                    } catch {
                      return false;
                    }
                  }),
              )
              .max(4000),
          )
          .max(10);
        if (value.richPages !== undefined) {
          const parsed = richSchema.safeParse(value.richPages);
          value.richPages = parsed.success ? parsed.data : [];
        }
        if (!controller.signal.aborted) setBody(value);
      } catch {
        /* Retain the supplied excerpt on failure. */
      } finally {
        if (!controller.signal.aborted) setBodyLoading(false);
      }
    })();
    return () => controller.abort();
  }, [article.id, bodyAttempt]);
  const mediaRequest = useYahooPhotos(article.id);
  const media =
    mediaRequest.resource?.kind === "article" ? mediaRequest.resource : null;
  const [chosenFeature, setChosenFeature] = useState<PhotoFeature | null>(null);
  const feature = chosenFeature || media?.features[0];
  const fullPictures = media?.pictures || [];
  function jump(element: HTMLElement | null) {
    restoring.current = false;
    element?.scrollIntoView({ block: "start" });
  }
  useLayoutEffect(() => {
    const element = dialog.current!;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    element.querySelector<HTMLButtonElement>(".reader-back")?.focus();
    let y = 0;
    const key = `romnoa:yahoo-position:${article.id}`;
    try {
      y = Math.max(0, Number(sessionStorage.getItem(key)) || 0);
    } catch {
      /* optional */
    }
    content.current!.scrollTop = y;
    restoring.current = y > 0;
    const node = content.current!;
    const observer = new ResizeObserver(() => {
      if (restoring.current) node.scrollTop = y;
    });
    observer.observe(node.firstElementChild!);
    const finish = () => {
      restoring.current = false;
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
      className={`reader yahoo-reader ${fullPictures.length ? "has-full-photos" : article.origin === "search" ? "yahoo-search-reader" : ""}`}
      aria-labelledby="yahoo-reader-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {bottomNav}
      <div className="reader-inner">
        <header className="reader-toolbar">
          <button
            className="button quiet reader-back"
            aria-label={onBack ? "元のニュースへ戻る" : "ニュースを閉じる"}
            onClick={() => {
              if (onBack) onBack();
              else onClose();
            }}
            autoFocus
          >
            <ArrowLeft size={17} />
            戻る
          </button>
        </header>
        <nav className="yahoo-detail-sections" aria-label="ニュース内の移動">
          <button onClick={() => jump(newsHeading.current)}>
            ニュース本文
          </button>
          <button onClick={() => jump(photos.current)}>記事の写真</button>
          {feature && (
            <button onClick={() => jump(featureSection.current)}>
              写真特集
            </button>
          )}
        </nav>
        <div className="reader-content" ref={content}>
          <div>
            <span className="pill">
              {yahooCategories.find((c) => c.id === article.category)?.label}
            </span>
            <h1 id="yahoo-reader-title" ref={newsHeading}>
              {article.title}
            </h1>
            <p className="reader-byline">
              Yahoo!ニュース {article.provider ? ` / ${article.provider}` : ""}{" "}
              · {article.displayDate || articleDate(article.publishedAt)}
            </p>
            <section
              className="reading-body yahoo-summary"
              aria-label={
                currentBody
                  ? "記事本文"
                  : article.origin === "search"
                    ? "検索結果の抜粋"
                    : "配信された記事冒頭"
              }
            >
              {currentBody ? (
                currentBody.pages.map((text, i) => {
                  const parts = currentBody.richPages?.[i];
                  return (
                    <div className="reader-text-block yahoo-full-text" key={i}>
                      {parts?.length
                        ? parts.map((part, n) =>
                            part.kind === "social" ? (
                              <SocialPostCard
                                key={`${n}:${part.url}`}
                                url={part.url!}
                                provider={socialPostUrl(part.url!)!.provider}
                              />
                            ) : part.kind === "photo" ? (
                              (() => {
                                // Photo links open the in-app gallery; when it
                                // is not available they stay plain text.
                                const target = linkedPhotoTarget(
                                  part.url!,
                                )?.url;
                                const linked = media?.features.find(
                                  (f) => f.url === target,
                                );
                                return linked ? (
                                  <button
                                    className="text-button inline-photo-link"
                                    key={n}
                                    onClick={() => {
                                      setChosenFeature(linked);
                                      jump(featureSection.current);
                                    }}
                                  >
                                    {part.text}
                                  </button>
                                ) : (
                                  <a
                                    key={n}
                                    href={part.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {part.text}
                                  </a>
                                );
                              })()
                            ) : part.kind === "link" ? (
                              <a
                                href={part.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                key={n}
                              >
                                {part.text}
                              </a>
                            ) : part.kind === "image" ? (
                              <img
                                src={part.url}
                                alt={part.text}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                key={n}
                              />
                            ) : (
                              <span key={n}>{part.text}</span>
                            ),
                          )
                        : text}
                    </div>
                  );
                })
              ) : (
                <p className="reader-text-block">
                  {article.summary ||
                    "このニュースには記事冒頭の配信がありません。"}
                </p>
              )}
            </section>
            {bodyLoading && (
              <p className="yahoo-note" role="status">
                記事本文を読み込み中…
              </p>
            )}
            {!bodyLoading && (!currentBody || !currentBody.complete) && (
              <p className="yahoo-note" role="status">
                {currentBody
                  ? "本文の一部を取得できませんでした。続きは元記事で読めます。"
                  : "本文を取得できませんでした。元記事で読めます。"}{" "}
                <button
                  className="text-button"
                  onClick={() => setBodyAttempt((n) => n + 1)}
                >
                  本文を再取得
                </button>
              </p>
            )}
            <div className="reader-actions">
              <a
                className="button primary"
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                元記事を開く
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
            <div ref={photos} className="yahoo-photo-section">
              <h2>記事の写真</h2>
              {!mediaRequest.loading &&
                !fullPictures.length &&
                !article.image && (
                  <p className="yahoo-note">
                    表示できる記事の写真はありません。
                  </p>
                )}
              {fullPictures.length ? (
                <>
                  <ArticleImages
                    key="full-article-photos"
                    pictures={fullPictures.map((p) => ({
                      url: p.url,
                      alt: p.alt || article.title,
                      role: "cover",
                    }))}
                  />
                  {fullPictures.some((p) => p.caption || p.credit) && (
                    <p className="yahoo-note photo-credit">
                      {fullPictures
                        .map((p) =>
                          [p.caption, p.credit].filter(Boolean).join(" / "),
                        )
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </>
              ) : (
                article.image && (
                  <ArticleImages
                    pictures={[
                      { url: article.image, alt: article.title, role: "cover" },
                    ]}
                  />
                )
              )}
              {mediaRequest.loading && (
                <p className="yahoo-note" role="status">
                  記事の大きい写真と写真特集を確認中…
                </p>
              )}
              {mediaRequest.error && (
                <p className="yahoo-note" role="status">
                  {mediaRequest.error}
                  <button className="text-button" onClick={mediaRequest.retry}>
                    写真情報を再取得
                  </button>
                </p>
              )}
              {media?.status === "cached" && (
                <p className="yahoo-note" role="status">
                  前回確認した写真情報を表示しています。
                </p>
              )}
            </div>
            {feature && (
              <div ref={featureSection} className="yahoo-feature-section">
                <YahooPhotoFeature
                  key={feature.url}
                  articleId={article.id}
                  feature={feature}
                />
              </div>
            )}
            {!!media?.features.length && (
              <section
                className="yahoo-photo-features"
                aria-label="この記事の写真特集"
              >
                <h2>ほかの写真特集</h2>
                {media.features.map((f) => (
                  <button
                    className="yahoo-related"
                    key={f.url}
                    aria-pressed={feature?.url === f.url}
                    onClick={() => {
                      setChosenFeature(f);
                      jump(featureSection.current);
                    }}
                  >
                    <span>{f.title}</span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </section>
            )}
            <p className="yahoo-note">
              元記事では広告が表示される場合があります。Safariでは対応する記事でページメニューからリーダー表示を利用できます。
            </p>
            {!!related.length && (
              <section
                className="yahoo-next-news"
                aria-label="同じカテゴリのニュース"
              >
                <h2>同じカテゴリのニュース</h2>
                <p className="yahoo-note">
                  検索結果やRSSから開けるニュースです。
                </p>
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
