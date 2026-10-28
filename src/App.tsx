import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowDownUp,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Grid2X2,
  Home,
  Leaf,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { ArticleRow } from "./components/ArticleRow";
import { Reader } from "./components/Reader";
import { DateFilter } from "./components/DateFilter";
import { ArticleSearch } from "./components/ArticleSearch";
import { MySearch } from "./components/MySearch";
import { HiddenUnlock, HiddenSearch } from "./components/HiddenSearch";
import { hiddenTitleAllowed, type HiddenGroups } from "./lib/hidden-model";
import { mergeLocalSearch, searchDay } from "./lib/search-results";
import { useSearch, savedSearchCollection } from "./lib/use-search";
import {
  normalizeSearch,
  validSearch,
  type SearchScope,
} from "./lib/search-model";
import { useDiscovery } from "./lib/use-discovery";
import { japanDay } from "./lib/discovery-model";
import {
  articleDate,
  categories,
  filterArticles,
  groupArticles,
  sourceInfo,
  type Article,
  type Category,
  type Sort,
} from "./lib/model";
import {
  loadPreferences,
  markRead,
  persistPreferences,
  type Preferences,
} from "./lib/storage";
import { useFeed } from "./lib/use-feed";

type Tab = "home" | "categories" | "saved" | "settings";
const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "ホーム", icon: Home },
  { id: "categories", label: "カテゴリ", icon: Grid2X2 },
  { id: "saved", label: "保存", icon: Bookmark },
  { id: "settings", label: "設定", icon: Settings2 },
];
const categoryDescriptions: Record<string, string> = {
  ニュース: "世の中の、いまを知る",
  暮らし: "毎日のこと、気になること",
  エンタメ: "好きな作品、新しい楽しみ",
  ゲーム: "遊びの話を、もっと",
  テクノロジー: "ちょっと先の、あたりまえ",
  話題: "思わず誰かに話したい",
};

type ReaderSelection = {
  articles: Article[];
  index: number;
  from?: string;
  collection?: string;
  collections?: Record<string, string>;
};

export default function App() {
  const [initial] = useState(loadPreferences);
  const [prefs, setPrefs] = useState<Preferences>(initial.value);
  const prefsRef = useRef(prefs);
  const [notice, setNotice] = useState(initial.warning);
  const [tab, setTab] = useState<Tab>("home");
  const [category, setCategory] = useState<Category>("すべて");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [date, setDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("title");
  const [mySearchOpen, setMySearchOpen] = useState(false);
  const [hiddenUnlock, setHiddenUnlock] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<HiddenGroups | null>(null);
  const [hiddenResult, setHiddenResult] = useState(false);
  const blankTaps = useRef({ count: 0, at: 0 });
  const [savedView, setSavedView] = useState<"saved" | "history">("saved");
  const [ngInput, setNgInput] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [readerTrail, setReaderTrail] = useState<ReaderSelection[]>([]);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const {
    feed,
    loading: feedLoading,
    error: feedError,
    offline,
    cached: feedCached,
    storageError: feedStorageError,
    refresh: refreshFeed,
  } = useFeed();
  const searchActive = tab === "home" && !!searchTerm;
  const pastSearch = useSearch(searchActive ? searchTerm : "", searchScope);
  const discoveryMode =
    tab === "home" && !searchActive
      ? sort === "popular"
        ? "popular"
        : date
          ? "date"
          : null
      : null;
  const discovery = useDiscovery(discoveryMode, date);
  const viewFeed = searchActive
    ? pastSearch.data
    : discoveryMode
      ? discovery.data
      : feed;
  const loading = searchActive
    ? pastSearch.loading
    : discoveryMode
      ? discovery.loading
      : feedLoading;
  const error = searchActive
    ? pastSearch.error
    : discoveryMode
      ? discovery.error
      : feedError;
  const cached = searchActive
    ? false
    : discoveryMode
      ? discovery.cached
      : feedCached;
  const storageError = discoveryMode
    ? discovery.storageError
    : feedStorageError;
  const refresh = searchActive
    ? pastSearch.refresh
    : discoveryMode
      ? discovery.refresh
      : refreshFeed;
  const effectiveSort =
    searchActive && sort === "popular" && !pastSearch.data?.bookmarks
      ? "newest"
      : sort;
  const ranks = useMemo(
    () =>
      Object.fromEntries(
        (discovery.data?.ranks || []).map((r) => [r.id, r.rank]),
      ),
    [discovery.data],
  );
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      void registration?.update();
    },
  });
  const scrollPositions = useRef<Record<string, number>>({});
  const viewKey = `${tab}:${category}:${savedView}${searchActive ? `:search:${searchTerm}:${searchScope}:${sort}` : discoveryMode ? `:${sort}:${date}` : ""}`;
  const previousView = useRef(viewKey);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dark =
    prefs.theme === "dark" || (prefs.theme === "system" && systemDark);
  function update(next: Preferences | ((prev: Preferences) => Preferences)) {
    const value = typeof next === "function" ? next(prefsRef.current) : next;
    prefsRef.current = value;
    setPrefs(value);
    if (!persistPreferences(value))
      setNotice(
        "端末に保存できませんでした。容量やブラウザの設定をご確認ください。この変更は再起動すると失われます。",
      );
  }
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.font = prefs.fontSize;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#151d19" : "#f7f8f4");
  }, [dark, prefs.fontSize]);
  useEffect(() => {
    const listener = (e: StorageEvent) => {
      if (e.key === "romnoa:preferences:v1") {
        const result = loadPreferences();
        prefsRef.current = result.value;
        setPrefs(result.value);
        if (result.warning) setNotice(result.warning);
      }
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, []);
  useLayoutEffect(() => {
    if (previousView.current !== viewKey) {
      previousView.current = viewKey;
      window.scrollTo(0, scrollPositions.current[viewKey] || 0);
    }
  }, [viewKey]);
  useEffect(() => {
    const key = `romnoa:scroll:${viewKey}`;
    try {
      const saved = Number(sessionStorage.getItem(key));
      if (saved) requestAnimationFrame(() => window.scrollTo(0, saved));
    } catch {
      /* best effort */
    }
    const save = () => {
      scrollPositions.current[viewKey] = window.scrollY;
      try {
        sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        /* best effort */
      }
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [viewKey]);
  // Restore after asynchronous feed loading makes the list tall enough.
  useEffect(() => {
    if (feed && tab === "home") {
      try {
        const y = Number(sessionStorage.getItem(`romnoa:scroll:${viewKey}`));
        if (y) requestAnimationFrame(() => window.scrollTo(0, y));
      } catch {
        /* best effort */
      }
    }
  }, [feed]);

  const all = feed?.articles || [];
  const searchArticles = useMemo(
    () =>
      mergeLocalSearch(
        pastSearch.data?.articles || [],
        [...prefs.saved, ...prefs.history.map((h) => h.article)],
        searchTerm,
      ),
    [pastSearch.data, prefs.saved, prefs.history, searchTerm],
  );
  const remoteSearchIds = useMemo(
    () => new Set(pastSearch.data?.articles.map((a) => a.id) || []),
    [pastSearch.data],
  );
  const localSearchCount = searchArticles.filter(
    (a) => !remoteSearchIds.has(a.id),
  ).length;
  const base =
    tab === "saved"
      ? savedView === "saved"
        ? prefs.saved
        : prefs.history.map((h) => h.article)
      : searchActive
        ? searchArticles
        : discoveryMode
          ? discovery.data?.articles || []
          : all;
  const articles = useMemo(() => {
    const filtered = filterArticles(base, {
      category,
      query: searchActive ? "" : query,
      sort: effectiveSort,
      read: prefs.read,
      hiddenSources: prefs.hiddenSources,
      ngWords: prefs.ngWords,
      ranks,
      includeUnmeasured: searchActive,
      popularity: searchActive
        ? pastSearch.data?.bookmarks || undefined
        : undefined,
    });
    const visible =
      hiddenResult && searchActive
        ? filtered.filter((a) => hiddenTitleAllowed(a.title))
        : filtered;
    if (tab === "saved" && savedView === "history")
      return visible.sort(
        (a, b) =>
          prefs.history.find((h) => h.article.id === b.id)!.at -
          prefs.history.find((h) => h.article.id === a.id)!.at,
      );
    return visible;
  }, [
    base,
    category,
    query,
    effectiveSort,
    prefs,
    tab,
    savedView,
    ranks,
    searchActive,
    pastSearch.data,
    hiddenResult,
  ]);
  const groups = useMemo(
    () => groupArticles(articles, prefs.groupSimilar && sort !== "popular"),
    [articles, prefs.groupSimilar, sort],
  );
  const savedIds = new Set(prefs.saved.map((a) => a.id));
  const selected = selection?.articles[selection.index];
  const filteredCount = filterArticles(all, {
    category: "すべて",
    query: "",
    hiddenSources: prefs.hiddenSources,
    ngWords: prefs.ngWords,
    sort: "newest",
    read: prefs.read,
  });

  function navigate(next: Tab) {
    scrollPositions.current[viewKey] = window.scrollY;
    setTab(next);
    setQuery("");
    setCategory("すべて");
    setDate("");
    setSearchTerm("");
    setHiddenResult(false);
    if (next !== "home") setHiddenGroups(null);
    if (next !== "home" && sort === "popular") setSort("newest");
  }
  function chooseCategory(next: Category) {
    scrollPositions.current[viewKey] = window.scrollY;
    setCategory(next);
    setTab("home");
    setQuery("");
  }
  function toggleSaved(article: Article) {
    if (!savedIds.has(article.id) && prefs.saved.length >= 200) {
      setNotice(
        "保存は200件までです。不要な記事の保存を解除してから追加してください。",
      );
      return;
    }
    update((p) => ({
      ...p,
      saved: p.saved.some((a) => a.id === article.id)
        ? p.saved.filter((a) => a.id !== article.id)
        : [article, ...p.saved],
    }));
  }
  function open(article: Article, sequence = articles) {
    setReaderTrail([]);
    update((p) => markRead(p, article));
    setSelection({
      articles: sequence,
      index: sequence.findIndex((a) => a.id === article.id),
      collections: searchActive
        ? Object.fromEntries(
            sequence.flatMap((a) => {
              const context =
                pastSearch.collections[a.id] || savedSearchCollection(a.id);
              return context ? [[a.id, context]] : [];
            }),
          )
        : undefined,
      collection: searchActive
        ? undefined
        : discoveryMode
          ? date
            ? `date:${date}`
            : "popular"
          : tab === "saved"
            ? article.publishedAt
              ? savedSearchCollection(article.id) ||
                `date:${japanDay(article.publishedAt)}`
              : "popular"
            : undefined,
    });
  }
  function toggleRead(article: Article) {
    update((p) => {
      if (!p.read[article.id]) return markRead(p, article);
      const read = { ...p.read };
      delete read[article.id];
      return { ...p, read };
    });
  }
  function addNg() {
    const word = ngInput.trim();
    if (!word || prefs.ngWords.includes(word)) return;
    if (prefs.ngWords.length >= 50) {
      setNotice("NGワードは50件まで登録できます。");
      return;
    }
    update((p) => ({ ...p, ngWords: [...p.ngWords, word] }));
    setNgInput("");
  }
  const showList = tab === "home" || tab === "saved";
  function startSearch(value: string, hidden = false) {
    const term = normalizeSearch(value);
    if (!validSearch(term)) return;
    pastSearch.reset();
    setQuery(term);
    setSearchTerm(term);
    setDate("");
    setCategory("すべて");
    setTab("home");
    setHiddenResult(hidden);
  }
  function blankTap(event: MouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    const now = Date.now();
    const taps = blankTaps.current;
    taps.count = now - taps.at < 1500 ? taps.count + 1 : 1;
    taps.at = now;
    if (taps.count === 3) {
      taps.count = 0;
      setHiddenUnlock(true);
    }
  }
  return (
    <>
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="/" aria-label="ROMNOA ホーム">
            <img src="/icon.svg" alt="" />
            <span>
              ROMNOA<small>Read freely.</small>
            </span>
          </a>
          <nav className="desktop-nav" aria-label="メインナビゲーション">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={tab === id ? "active" : ""}
                aria-current={tab === id ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={1.7} />
                {label}
                {id === "saved" && prefs.saved.length > 0 && (
                  <span className="nav-count">{prefs.saved.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-categories">
            <span className="eyebrow">YOUR INTERESTS</span>
            {categories.slice(1).map((c) => (
              <button key={c} onClick={() => chooseCategory(c)}>
                <span className={`category-dot dot-${categories.indexOf(c)}`} />
                {c}
              </button>
            ))}
          </div>
          <div className="sidebar-footer">
            <Leaf size={20} strokeWidth={1.4} />
            <p>
              ひと息ついて、
              <br />
              読みたいものを。
            </p>
            <span>ROMNOA · ロムノア</span>
            <small>個人利用プレビュー · v0.1</small>
          </div>
        </aside>

        <div className="main-shell">
          <header className="topbar">
            <a className="mobile-brand" href="/">
              <img src="/icon.svg" alt="" />
              ROMNOA
            </a>
            <span className="topbar-label">あなたの、読む時間。</span>
            <div className="topbar-tools">
              <span className="ad-free">
                <span />
                アプリ内リーダー
              </span>
              <button
                className="icon-button"
                aria-label={
                  dark ? "ライトモードに切り替え" : "ダークモードに切り替え"
                }
                onClick={() =>
                  update((p) => ({ ...p, theme: dark ? "light" : "dark" }))
                }
              >
                {dark ? <Sun size={19} /> : <Moon size={19} />}
              </button>
            </div>
          </header>
          <main onClick={blankTap} id="main" className="main-content">
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  {tab === "home"
                    ? "YOUR DAILY READING"
                    : tab === "categories"
                      ? "FIND YOUR INTEREST"
                      : tab === "saved"
                        ? "YOUR READING SHELF"
                        : "MAKE IT YOURS"}
                </span>
                <h1 ref={headingRef}>
                  {tab === "home"
                    ? "ホーム"
                    : tab === "categories"
                      ? "カテゴリ"
                      : tab === "saved"
                        ? "あなたの本棚"
                        : "設定"}
                </h1>
                <p>
                  {tab === "home"
                    ? "読みたい話題だけ、ノイズなく。"
                    : tab === "categories"
                      ? "気になることから、読みはじめよう。"
                      : tab === "saved"
                        ? "気になった記事を、好きなときに。"
                        : "読む時間を、あなたらしく。"}
                </p>
              </div>
              {tab === "home" && (
                <button
                  className={`button refresh-button ${loading ? "refreshing" : ""}`}
                  onClick={() => void refresh()}
                  disabled={loading}
                  aria-label="記事を更新"
                >
                  <RefreshCw size={16} />
                  <span>{loading ? "取得中" : "更新する"}</span>
                </button>
              )}
            </div>

            {(notice || storageError) && (
              <div className="status-banner warning" role="alert">
                <span>
                  {notice ||
                    "記事を端末にキャッシュできませんでした。オフライン表示は利用できない場合があります。"}
                </span>
                <button
                  className="icon-button"
                  onClick={() => setNotice("")}
                  aria-label="通知を閉じる"
                >
                  <X size={17} />
                </button>
              </div>
            )}
            {needRefresh && (
              <div className="status-banner">
                <span>新しいバージョンを利用できます。</span>
                <button
                  className="text-button"
                  onClick={() => void updateServiceWorker(true)}
                >
                  更新する
                </button>
              </div>
            )}
            {offline && (
              <div className="status-banner" role="status">
                <WifiOff size={18} />
                オフラインです。端末に残っている記事と保存内容を表示します。
              </div>
            )}
            {error && (
              <div className="status-banner warning" role="status">
                <span>{error}</span>
                <button
                  className="text-button"
                  onClick={() => void refresh()}
                  disabled={loading}
                >
                  再試行
                </button>
              </div>
            )}
            {viewFeed?.sources.some((s) => s.status !== "ok") && (
              <div className="status-banner warning" role="status">
                {viewFeed.sources
                  .filter((s) => s.status !== "ok")
                  .map(
                    (s) =>
                      `${sourceInfo.find((x) => x.id === s.id)!.name}: ${s.status === "cached" ? "取得に失敗したため、前回の記事を表示中" : "現在取得できません"}`,
                  )
                  .join(" / ")}
              </div>
            )}

            {tab === "home" && (
              <section className="welcome-card">
                <div className="welcome-copy">
                  <span className="eyebrow">
                    <Sparkles size={13} /> A LITTLE LESS NOISE
                  </span>
                  <h2>
                    読むことに、
                    <br className="mobile-break" />
                    もっと自由を。
                  </h2>
                  <p>
                    いくつものサイトの新着を、ひとつの場所に。
                    <br />
                    気になる話題を見つけて、あとでゆっくり。
                  </p>
                  <span className="welcome-note">
                    <ShieldCheck size={14} />
                    記事の画像を、広告なしで。気になる関連記事へ、そのまま。
                  </span>
                </div>
                <div className="book-art" aria-hidden="true">
                  <div className="book-shadow" />
                  <div className="book-page page-left">
                    <i />
                    <i />
                    <i />
                    <b />
                  </div>
                  <div className="book-page page-right">
                    <i />
                    <i />
                    <i />
                    <b />
                  </div>
                  <span className="book-bookmark" />
                  <Leaf className="book-leaf" size={46} strokeWidth={1} />
                  <span className="art-star">✳</span>
                </div>
              </section>
            )}

            {showList && (
              <div className="reading-layout">
                <section
                  className="feed-column"
                  aria-label={tab === "saved" ? "保存した記事" : "新着記事"}
                >
                  {tab === "saved" && (
                    <div className="segmented shelf-tabs">
                      <button
                        className={savedView === "saved" ? "selected" : ""}
                        aria-pressed={savedView === "saved"}
                        onClick={() => setSavedView("saved")}
                      >
                        <Bookmark size={16} />
                        保存した記事<span>{prefs.saved.length}</span>
                      </button>
                      <button
                        className={savedView === "history" ? "selected" : ""}
                        aria-pressed={savedView === "history"}
                        onClick={() => setSavedView("history")}
                      >
                        <Clock3 size={16} />
                        閲覧履歴
                      </button>
                    </div>
                  )}
                  {tab === "home" ? (
                    <>
                      <ArticleSearch
                        query={query}
                        active={searchTerm}
                        scope={searchScope}
                        onScope={(scope) => {
                          pastSearch.reset();
                          setSearchScope(scope);
                        }}
                        onQuery={(value) => {
                          setQuery(value);
                          if (!value) {
                            setSearchTerm("");
                            setHiddenResult(false);
                          }
                        }}
                        onSubmit={() => startSearch(query)}
                        onClear={() => {
                          setQuery("");
                          setSearchTerm("");
                          setHiddenResult(false);
                        }}
                        onLocal={() => {
                          setQuery("");
                          setSearchTerm("");
                          setHiddenResult(false);
                        }}
                      />
                      <button
                        className="text-button my-search-toggle"
                        aria-expanded={mySearchOpen}
                        onClick={() => setMySearchOpen(!mySearchOpen)}
                      >
                        マイ検索
                      </button>
                      {mySearchOpen && (
                        <MySearch
                          onSearch={(term) => startSearch(term)}
                          onClose={() => setMySearchOpen(false)}
                        />
                      )}
                      {hiddenGroups && (
                        <HiddenSearch
                          groups={hiddenGroups}
                          onSearch={(term) => startSearch(term, true)}
                          onClose={() => {
                            setHiddenGroups(null);
                            if (hiddenResult) {
                              setSearchTerm("");
                              setQuery("");
                              setHiddenResult(false);
                            }
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <div className="search-box">
                      <Search size={18} />
                      <input
                        type="search"
                        placeholder="気になるキーワードを検索"
                        aria-label="記事を検索"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button
                          className="icon-button"
                          aria-label="検索をクリア"
                          onClick={() => setQuery("")}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  )}
                  <div
                    className="category-chips"
                    aria-label="カテゴリで絞り込み"
                  >
                    {categories.map((c) => (
                      <button
                        key={c}
                        className={category === c ? "selected" : ""}
                        aria-pressed={category === c}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {tab === "home" && !searchActive && (
                    <DateFilter key={date} date={date} onChange={setDate} />
                  )}
                  {searchActive && (
                    <div className="search-results-note" role="status">
                      <p>検索期間：全期間（日付の制限なし）</p>
                      <p>
                        表示件数は見つかった記事の累計です。全期間の総ヒット数ではありません。
                      </p>
                      {pastSearch.data?.searchedRange.from && (
                        <p>
                          ここまで確認した記事の日付：
                          {searchDay(pastSearch.data.searchedRange.from)} 〜{" "}
                          {searchDay(pastSearch.data.searchedRange.to)}
                          （配信元の検索結果 {pastSearch.page}ページ分）
                        </p>
                      )}
                      {pastSearch.searching && (
                        <p>
                          過去の記事も確認中です。見つかり次第、この一覧に追加します。
                        </p>
                      )}
                      {!pastSearch.searching &&
                        pastSearch.data &&
                        !pastSearch.data.nextSources.length &&
                        !error && (
                          <p>
                            配信元が検索で提供する最後のページまで確認しました。未収録・削除済みの記事を含む全記事の網羅は保証できません。
                          </p>
                        )}
                      {!!localSearchCount && (
                        <p>
                          保存・履歴のタイトルに一致した記事 {localSearchCount}
                          件も含めています。日付不明の記事も対象です。
                        </p>
                      )}
                      <p>
                        {searchScope === "title"
                          ? "タイトルに検索語が含まれる記事だけを表示します。"
                          : "タイトルと記事本文で照合しています。おすすめ欄・関連記事・広告・リンクの文字は検索対象から除外します。"}{" "}
                        複数の語はすべて含む記事を探します。
                      </p>
                      {!!pastSearch.data?.excludedCount && (
                        <p>
                          検索語が一致しない候補 {pastSearch.data.excludedCount}
                          件を除外しました。
                        </p>
                      )}
                      {!!pastSearch.data?.unverifiedCount && (
                        <p>
                          本文を確認できなかった{" "}
                          {pastSearch.data.unverifiedCount}
                          件は表示していません。時間をおいて更新すると再確認できます。
                        </p>
                      )}
                      {!pastSearch.searching &&
                        pastSearch.data &&
                        !searchArticles.length &&
                        !!pastSearch.data.nextSources.length && (
                          <p>
                            ここまで一致する記事はありません。「さらに過去の記事」で検索を続けられます。
                          </p>
                        )}
                      <p>
                        人気順は、ここまで取得した記事のはてなブックマーク数順です。端末の保存・履歴だけにある記事は人気データがないため末尾に表示します。
                      </p>
                      {pastSearch.data?.bookmarks === null && (
                        <p>
                          人気データを取得できませんでした。新着順で表示しています。
                        </p>
                      )}
                      {hiddenResult && (
                        <p>
                          未成年を示す見出しなど、候補に適さない記事は表示から除いています。
                        </p>
                      )}
                    </div>
                  )}
                  {discoveryMode && (
                    <div className="discovery-note" role="status">
                      {sort === "popular" ? (
                        <>
                          <p>
                            配信元の現在の人気順を、サイト別に表示しています。
                          </p>
                          <p>
                            ハムスター速報：直近1週間／アルファルファモザイク：掲載中のTOP6（集計期間非公表）
                          </p>
                          {date && (
                            <p>
                              {date}
                              掲載の記事で絞り込み中。過去の人気順位ではありません。
                            </p>
                          )}
                        </>
                      ) : (
                        <p>
                          {date}
                          （日本時間）の記事を、配信元の日付別ページから取得しています。
                        </p>
                      )}
                      {discovery.data?.limitedSources.length ? (
                        <p>
                          配信元の一覧の一部を表示しています。全件の取得は保証していません。
                        </p>
                      ) : null}
                      {discovery.data?.unavailableSources.length ? (
                        <p>
                          {discovery.data.unavailableSources
                            .map(
                              (id) => sourceInfo.find((s) => s.id === id)!.name,
                            )
                            .join("・")}
                          には、この日付の一覧がありません。上のキーワード検索なら全期間から探せます。
                        </p>
                      ) : null}
                      {cached && <p>前回取得した情報を表示しています。</p>}
                      {error && (
                        <button className="text-button" onClick={refresh}>
                          この一覧を再試行
                        </button>
                      )}
                    </div>
                  )}
                  <div className="list-heading">
                    <h2>
                      {tab === "saved"
                        ? savedView === "history"
                          ? "最近読んだ記事"
                          : "保存した記事"
                        : searchActive
                          ? `「${searchTerm}」の検索結果`
                          : sort === "popular"
                            ? "人気記事（サイト別）"
                            : date
                              ? `${date}の記事`
                              : query
                                ? "検索結果"
                                : category === "すべて"
                                  ? "新着記事"
                                  : category}
                      <span>{groups.length}</span>
                    </h2>
                    {!(tab === "saved" && savedView === "history") && (
                      <label className="sort-control">
                        <ArrowDownUp size={14} />
                        <select
                          aria-label="記事の並び順"
                          value={sort}
                          onChange={(e) => setSort(e.target.value as Sort)}
                        >
                          <option value="newest">新着順</option>
                          <option value="unread">未読優先</option>
                          <option value="category">カテゴリ別</option>
                          {tab === "home" && (
                            <option
                              value="popular"
                              disabled={
                                searchActive &&
                                pastSearch.data?.bookmarks === null
                              }
                            >
                              {searchActive
                                ? "人気順（ブックマーク数）"
                                : "人気順（サイト別）"}
                            </option>
                          )}
                        </select>
                      </label>
                    )}
                  </div>
                  {query && !searchActive && (
                    <p className="search-note">
                      取得済みの記事から検索しています。
                    </p>
                  )}
                  <div
                    className="article-list"
                    aria-busy={loading && !viewFeed && !articles.length}
                  >
                    {loading && !viewFeed && !articles.length ? (
                      <div
                        className="skeleton-list"
                        role="status"
                        aria-label="記事を読み込み中"
                      >
                        {[1, 2, 3, 4].map((n) => (
                          <div className="skeleton-row" key={n}>
                            <i />
                            <span>
                              <b />
                              <b />
                              <b />
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : groups.length === 0 ? (
                      <div className="empty-state">
                        <BookOpen size={35} strokeWidth={1.2} />
                        <h3>
                          {tab === "saved"
                            ? savedView === "saved"
                              ? "気になる記事を、ここに。"
                              : "読んだ記事がここに並びます"
                            : error
                              ? "記事を取得できませんでした"
                              : "表示する記事がありません"}
                        </h3>
                        <p>
                          {tab === "saved" && savedView === "saved"
                            ? "記事のしおりをタップすると、あとで読む記事を保存できます。"
                            : "検索・カテゴリ・配信元・NGワードの設定をご確認ください。"}
                        </p>
                        {(query || category !== "すべて" || date) && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              setQuery("");
                              setCategory("すべて");
                              setDate("");
                            }}
                          >
                            絞り込みを解除
                          </button>
                        )}
                        {tab === "home" && (
                          <button
                            className="text-button"
                            onClick={() => navigate("settings")}
                          >
                            配信元とNGワードを確認
                            <ArrowRight size={15} />
                          </button>
                        )}
                      </div>
                    ) : (
                      groups.map((group) => (
                        <div className="article-group" key={group[0].id}>
                          {sort === "popular" && !searchActive && (
                            <div className="rank-label">
                              <span>
                                {
                                  sourceInfo.find(
                                    (s) => s.id === group[0].sourceId,
                                  )!.name
                                }
                              </span>
                              <strong>{ranks[group[0].id]}位</strong>
                            </div>
                          )}
                          {searchActive &&
                            pastSearch.data?.bookmarks?.[group[0].id] !==
                              undefined && (
                              <p className="bookmark-metric">
                                はてなブックマーク{" "}
                                {pastSearch.data!.bookmarks![group[0].id]}件
                              </p>
                            )}
                          {searchActive &&
                            !remoteSearchIds.has(group[0].id) && (
                              <p className="local-search-label">
                                保存・履歴から見つかった記事
                              </p>
                            )}
                          <ArticleRow
                            article={group[0]}
                            saved={savedIds.has(group[0].id)}
                            read={!!prefs.read[group[0].id]}
                            onOpen={() => open(group[0])}
                            onSave={() => toggleSaved(group[0])}
                          />
                          {group.length > 1 && (
                            <>
                              <button
                                className="similar-toggle"
                                aria-expanded={expanded.includes(group[0].id)}
                                onClick={() =>
                                  setExpanded((p) =>
                                    p.includes(group[0].id)
                                      ? p.filter((id) => id !== group[0].id)
                                      : [...p, group[0].id],
                                  )
                                }
                              >
                                似ている記事 {group.length - 1}件
                                <ChevronRight size={13} />
                              </button>
                              {expanded.includes(group[0].id) &&
                                group
                                  .slice(1)
                                  .map((a) => (
                                    <ArticleRow
                                      key={a.id}
                                      article={a}
                                      saved={savedIds.has(a.id)}
                                      read={!!prefs.read[a.id]}
                                      onOpen={() => open(a)}
                                      onSave={() => toggleSaved(a)}
                                    />
                                  ))}
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  {searchActive && (
                    <nav
                      className="search-pagination"
                      aria-label="検索結果のページ移動"
                    >
                      <span>
                        {pastSearch.searching
                          ? "過去の記事を確認中…"
                          : `${pastSearch.page}ページ分を検索済み`}
                      </span>
                      <button
                        className="button secondary"
                        onClick={pastSearch.next}
                        disabled={
                          pastSearch.searching ||
                          !pastSearch.data?.nextSources.length
                        }
                      >
                        さらに過去の記事
                      </button>
                    </nav>
                  )}
                  {tab === "home" && (
                    <footer className="feed-footer">
                      <span
                        className={`connection-dot ${offline || error ? "disconnected" : ""}`}
                      />
                      {viewFeed
                        ? `${cached ? "端末キャッシュ · " : ""}${articleDate(viewFeed.generatedAt)} 更新情報`
                        : "配信元の新着をお届けします"}
                      <span>
                        {date && date !== japanDay() && sort !== "popular"
                          ? "過去の日付は最大24時間キャッシュ"
                          : "取得間隔 約10分"}
                      </span>
                    </footer>
                  )}
                </section>
                <aside className="reading-aside">
                  <section className="aside-card">
                    <span className="eyebrow">YOUR READING</span>
                    <h3>今日も、自分のペースで。</h3>
                    <div className="reading-stats">
                      <div>
                        <strong>
                          {
                            filteredCount.filter((a) => !prefs.read[a.id])
                              .length
                          }
                        </strong>
                        <span>見つかる未読</span>
                      </div>
                      <div>
                        <strong>{prefs.saved.length}</strong>
                        <span>あとで読む</span>
                      </div>
                    </div>
                    <button
                      className="aside-link"
                      onClick={() => navigate("saved")}
                    >
                      本棚を開く
                      <ArrowRight size={15} />
                    </button>
                  </section>
                  <section className="aside-sources">
                    <span className="eyebrow">SOURCES</span>
                    <h3>新着を届けるサイト</h3>
                    {sourceInfo.map((s) => (
                      <div className="source-status" key={s.id}>
                        <span className={`tiny-monogram source-${s.id}`}>
                          {s.short}
                        </span>
                        <span>{s.name}</span>
                        <span
                          className={`source-indicator ${prefs.hiddenSources.includes(s.id) ? "muted" : feed?.sources.find((x) => x.id === s.id)?.status === "ok" ? "" : "muted"}`}
                        />
                      </div>
                    ))}
                    <button
                      className="text-button"
                      onClick={() => navigate("settings")}
                    >
                      配信元をカスタマイズ
                      <Settings2 size={14} />
                    </button>
                  </section>
                  <section className="small-note">
                    <BookOpen size={20} strokeWidth={1.4} />
                    <h3>気持ちよく、読むために。</h3>
                    <p>
                      記事はアプリ内リーダーで開きます。広告や外部の埋め込みを除き、記事の画像・動画を読みやすく表示します。配信元のページを開く操作は任意です。
                    </p>
                  </section>
                </aside>
              </div>
            )}

            {tab === "categories" && (
              <>
                <div className="category-grid">
                  {categories.slice(1).map((c, i) => (
                    <button
                      className="category-card"
                      key={c}
                      onClick={() => chooseCategory(c)}
                    >
                      <span className={`category-number dot-${i + 1}`}>
                        0{i + 1}
                      </span>
                      <h2>{c}</h2>
                      <p>{categoryDescriptions[c]}</p>
                      <span className="category-card-footer">
                        {filteredCount.filter((a) => a.category === c).length}{" "}
                        件の記事
                        <ArrowRight size={18} />
                      </span>
                    </button>
                  ))}
                </div>
                <p className="muted-note">
                  カテゴリは配信元の分類と記事タイトルから推定しています。
                </p>
              </>
            )}

            {tab === "settings" && (
              <div className="settings-layout">
                <div className="settings-column">
                  <section className="settings-card">
                    <div className="settings-title">
                      <Sun size={19} />
                      <h2>読みやすさ</h2>
                    </div>
                    <label className="setting-row">
                      <span>
                        表示モード<small>端末に合わせることもできます</small>
                      </span>
                      <select
                        aria-label="表示モード"
                        value={prefs.theme}
                        onChange={(e) =>
                          update((p) => ({
                            ...p,
                            theme: e.target.value as Preferences["theme"],
                          }))
                        }
                      >
                        <option value="system">端末に合わせる</option>
                        <option value="light">ライト</option>
                        <option value="dark">ダーク</option>
                      </select>
                    </label>
                    <div className="setting-row">
                      <span>文字サイズ</span>
                      <div className="segmented font-options">
                        {(
                          [
                            ["small", "小"],
                            ["medium", "標準"],
                            ["large", "大"],
                          ] as const
                        ).map(([size, label]) => (
                          <button
                            key={size}
                            className={
                              prefs.fontSize === size ? "selected" : ""
                            }
                            aria-pressed={prefs.fontSize === size}
                            onClick={() =>
                              update((p) => ({ ...p, fontSize: size }))
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="setting-row">
                      <span>
                        似ている記事をまとめる
                        <small>タイトルが近い記事を折りたたみます</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={prefs.groupSimilar}
                        onChange={(e) =>
                          update((p) => ({
                            ...p,
                            groupSimilar: e.target.checked,
                          }))
                        }
                      />
                    </label>
                  </section>
                  <section className="settings-card">
                    <div className="settings-title">
                      <Grid2X2 size={19} />
                      <h2>配信元</h2>
                    </div>
                    <p className="setting-help">
                      表示するサイトを選べます。本文はアプリ内リーダーで開きます。
                    </p>
                    {sourceInfo.map((s) => (
                      <label className="setting-row source-setting" key={s.id}>
                        <span className={`tiny-monogram source-${s.id}`}>
                          {s.short}
                        </span>
                        <span>
                          {s.name}
                          <small>{new URL(s.url).hostname}</small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`${s.name}を表示`}
                          checked={!prefs.hiddenSources.includes(s.id)}
                          onChange={(e) =>
                            update((p) => ({
                              ...p,
                              hiddenSources: e.target.checked
                                ? p.hiddenSources.filter((id) => id !== s.id)
                                : [...p.hiddenSources, s.id],
                            }))
                          }
                        />
                      </label>
                    ))}
                  </section>
                  <section className="settings-card">
                    <div className="settings-title">
                      <ShieldCheck size={19} />
                      <h2>NGワード</h2>
                    </div>
                    <p className="setting-help">
                      タイトルに含まれる記事を非表示にします。最大50件。
                    </p>
                    <form
                      className="ng-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addNg();
                      }}
                    >
                      <input
                        aria-label="NGワード"
                        placeholder="表示したくないキーワード"
                        maxLength={80}
                        value={ngInput}
                        onChange={(e) => setNgInput(e.target.value)}
                      />
                      <button
                        className="button primary"
                        disabled={!ngInput.trim()}
                      >
                        <Plus size={17} />
                        追加
                      </button>
                    </form>
                    <div className="ng-tags">
                      {prefs.ngWords.length ? (
                        prefs.ngWords.map((word) => (
                          <button
                            key={word}
                            onClick={() =>
                              update((p) => ({
                                ...p,
                                ngWords: p.ngWords.filter((w) => w !== word),
                              }))
                            }
                            aria-label={`NGワードを削除: ${word}`}
                          >
                            {word}
                            <X size={13} />
                          </button>
                        ))
                      ) : (
                        <span>まだ登録されていません</span>
                      )}
                    </div>
                  </section>
                  <section className="settings-card">
                    <div className="settings-title">
                      <Clock3 size={19} />
                      <h2>端末のデータ</h2>
                    </div>
                    <p className="setting-help">
                      設定・保存・履歴はこのブラウザだけに保存されます。端末間では同期されません。ブラウザのデータ削除で失われます。
                    </p>
                    <details className="clear-data">
                      <summary>履歴・既読をリセット</summary>
                      <p>
                        閲覧履歴と既読を削除します。保存した記事は残ります。
                      </p>
                      <button
                        className="button danger"
                        onClick={() => {
                          update((p) => ({ ...p, history: [], read: {} }));
                          setNotice("履歴と既読をリセットしました。");
                        }}
                      >
                        履歴・既読を削除する
                      </button>
                    </details>
                  </section>
                </div>
                <aside className="settings-side">
                  <section className="install-card">
                    <img src="/icon.svg" alt="" />
                    <span className="eyebrow">ALWAYS WITH YOU</span>
                    <h2>
                      ホーム画面に、
                      <br />
                      ロムノアを。
                    </h2>
                    <p>
                      Safariの共有メニューから
                      <br />
                      「ホーム画面に追加」を選択。
                      <br />
                      いつもの読む時間が、すぐそこに。
                    </p>
                    <span className="pill">インストール無料</span>
                  </section>
                  <section className="small-note">
                    <ShieldCheck size={20} />
                    <h3>Read freely.</h3>
                    <p>
                      広告・トラッキングSDKは使いません。記事の収集・本文取得はサーバーで行います。記事画像と関連記事のサムネイルは、選別後に配信元の画像サーバーから読み込みます。広告・誘導画像と判定できるもの、判定保留の画像は読み込みません。
                    </p>
                    <p>
                      個人用プレビューの読書機能です。一般公開に向けた本文の利用条件・許諾確認は別途必要です。
                    </p>
                  </section>
                </aside>
              </div>
            )}
            <footer className="page-footer" onClick={blankTap}>
              <span>
                ROMNOA <span>—</span> Read freely.
              </span>
              <small>読む時間に、余白を。</small>
            </footer>
          </main>
        </div>
      </div>
      <nav className="bottom-nav" aria-label="下部ナビゲーション">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={21} strokeWidth={tab === id ? 2 : 1.6} />
            <span>{label}</span>
            {id === "saved" && prefs.saved.length > 0 && <i />}
          </button>
        ))}
      </nav>
      {hiddenUnlock && (
        <HiddenUnlock
          onClose={() => setHiddenUnlock(false)}
          onUnlock={(groups) => {
            setHiddenUnlock(false);
            setHiddenGroups(groups);
            setTab("home");
            window.scrollTo(0, 0);
          }}
        />
      )}
      {selected && selection && (
        <Reader
          article={selected}
          from={selection.from}
          collection={
            selection.collections
              ? selection.collections[selected.id]
              : selection.collection
          }
          onRelated={(article) => {
            setReaderTrail((trail) => [...trail, selection].slice(-50));
            update((p) => markRead(p, article));
            setSelection({ articles: [article], index: 0, from: selected.id });
          }}
          onBack={
            readerTrail.length
              ? () => {
                  setSelection(readerTrail[readerTrail.length - 1]);
                  setReaderTrail((trail) => trail.slice(0, -1));
                }
              : undefined
          }
          hiddenSources={prefs.hiddenSources}
          ngWords={prefs.ngWords}
          saved={savedIds.has(selected.id)}
          read={!!prefs.read[selected.id]}
          index={selection.index}
          total={selection.articles.length}
          onClose={() => setSelection(null)}
          onSave={() => toggleSaved(selected)}
          onRead={() => toggleRead(selected)}
          onMove={(delta) => {
            const index = selection.index + delta;
            if (index >= 0 && index < selection.articles.length) {
              update((p) => markRead(p, selection.articles[index]));
              setSelection({ ...selection, index });
            }
          }}
        />
      )}
    </>
  );
}
