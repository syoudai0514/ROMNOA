import { useLayoutEffect, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ExternalLink,
  BookOpen,
  X,
} from "lucide-react";
import { articleDate, sourceInfo, type Article } from "../lib/model";

export function Reader({
  article,
  saved,
  read,
  index,
  total,
  onClose,
  onSave,
  onRead,
  onMove,
}: {
  article: Article;
  saved: boolean;
  read: boolean;
  index: number;
  total: number;
  onClose: () => void;
  onSave: () => void;
  onRead: () => void;
  onMove: (delta: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const source = sourceInfo.find((s) => s.id === article.sourceId)!;
  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  useLayoutEffect(() => {
    const el = content.current!;
    try {
      el.scrollTop =
        Number(sessionStorage.getItem(`romnoa:detail:${article.id}`)) || 0;
    } catch {
      /* session storage unavailable */
    }
    return () => {
      try {
        sessionStorage.setItem(
          `romnoa:detail:${article.id}`,
          String(el.scrollTop),
        );
      } catch {
        /* best effort */
      }
    };
  }, [article.id]);
  return (
    <dialog
      ref={dialog}
      className="reader"
      aria-labelledby="reader-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="reader-inner">
        <header className="reader-toolbar">
          <span className="eyebrow">ROMNOA / ARTICLE</span>
          <button
            className="icon-button"
            aria-label="記事を閉じる"
            onClick={onClose}
            autoFocus
          >
            <X size={21} />
          </button>
        </header>
        <div className="reader-content" ref={content}>
          <span className="pill">{article.category}</span>
          <h1 id="reader-title">{article.title}</h1>
          <p className="reader-byline">
            {source.name}
            <span>·</span>
            {articleDate(article.publishedAt)}
          </p>
          <div className="reader-actions">
            <button
              className={`button secondary ${saved ? "is-saved" : ""}`}
              aria-pressed={saved}
              onClick={onSave}
            >
              <Bookmark size={17} fill={saved ? "currentColor" : "none"} />
              {saved ? "保存済み" : "あとで読む"}
            </button>
            <button
              className="button quiet"
              aria-pressed={read}
              onClick={onRead}
            >
              <Check size={17} />
              {read ? "未読に戻す" : "既読にする"}
            </button>
          </div>
          <section className="external-reading">
            <BookOpen size={29} strokeWidth={1.3} />
            <h2>続きは、配信元で。</h2>
            <p>
              {source.name}が配信した{article.category}
              の記事です。本文・画像は元サイトでご覧いただけます。
            </p>
            <a
              className="button primary"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (!read) onRead();
              }}
            >
              元の記事を読む
              <ExternalLink size={16} />
            </a>
            <small>
              外部サイトが開きます。広告が表示される場合があります。
            </small>
          </section>
          <details className="reader-tip">
            <summary>Safariで読みやすくするには</summary>
            <p>
              元記事をSafariで開き、アドレスバーのページメニューから「リーダーを表示」を選びます。対応しているページで利用でき、すべての広告が消えることを保証するものではありません。
            </p>
          </details>
          <p className="rights-note">
            配信元の権利を尊重し、ロムノアではこの記事の本文を転載していません。
          </p>
        </div>
        <footer className="reader-footer">
          <button
            className="button quiet"
            disabled={index <= 0}
            onClick={() => onMove(-1)}
          >
            <ArrowLeft size={18} />
            前の記事
          </button>
          <span>
            {index + 1} / {total}
          </span>
          <button
            className="button quiet"
            disabled={index >= total - 1}
            onClick={() => onMove(1)}
          >
            次の記事
            <ArrowRight size={18} />
          </button>
        </footer>
      </div>
    </dialog>
  );
}
