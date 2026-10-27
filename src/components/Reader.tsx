import { useLayoutEffect, useRef, useState } from "react";
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
import { useReader } from "../lib/use-reader";

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
  const reading = useReader(article.id);
  const [imagesFor, setImagesFor] = useState("");
  const positions = useRef<Record<string, number>>({});
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
      positions.current[article.id] =
        Number(sessionStorage.getItem(`romnoa:detail:${article.id}`)) || 0;
      el.scrollTop = positions.current[article.id];
    } catch {
      /* session storage unavailable */
    }
    return () => {
      try {
        sessionStorage.setItem(
          `romnoa:detail:${article.id}`,
          String(positions.current[article.id] || 0),
        );
      } catch {
        /* best effort */
      }
    };
  }, [article.id]);
  useLayoutEffect(() => {
    if (reading.document && content.current)
      content.current.scrollTop = positions.current[article.id] || 0;
  }, [reading.document, article.id]);
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
        <div
          className="reader-content"
          ref={content}
          onScroll={(e) => {
            if (!reading.document) return;
            const y = e.currentTarget.scrollTop;
            positions.current[article.id] = y;
            try {
              sessionStorage.setItem(`romnoa:detail:${article.id}`, String(y));
            } catch {
              /* optional position persistence */
            }
          }}
        >
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
          {reading.loading && (
            <div className="reader-loading" role="status">
              <BookOpen size={28} />
              <p>本文を読み込んでいます…</p>
            </div>
          )}
          {reading.error && (
            <section className="reader-failure" role="alert">
              <h2>本文を読み込めませんでした</h2>
              <p>{reading.error}</p>
              <button className="button secondary" onClick={reading.retry}>
                再試行
              </button>
            </section>
          )}
          {reading.document && (
            <section className="reading-body" aria-label="記事本文">
              <div className="reading-body-label">
                <Check size={14} />
                アプリ内リーダー<span>出典：{source.name}</span>
              </div>
              {reading.document.blocks.some((b) => b.type === "image") && (
                <button
                  className="button secondary image-consent"
                  onClick={() =>
                    setImagesFor(imagesFor === article.id ? "" : article.id)
                  }
                  aria-pressed={imagesFor === article.id}
                >
                  {imagesFor === article.id
                    ? "画像を非表示"
                    : "記事の画像を表示"}
                </button>
              )}
              {reading.document.blocks.map((block, i) =>
                block.type === "text" ? (
                  <p key={i}>{block.text}</p>
                ) : imagesFor === article.id ? (
                  <figure key={i}>
                    <img
                      src={block.url}
                      alt={block.alt}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  </figure>
                ) : (
                  <div className="reader-image-placeholder" key={i}>
                    記事内の画像（表示ボタンで読み込み）
                  </div>
                ),
              )}
              {reading.storageError && (
                <p className="reader-storage-warning" role="status">
                  本文を端末に保存できませんでした。この画面では引き続き読めます。
                </p>
              )}
            </section>
          )}
          <details className="reader-original" key={article.id}>
            <summary>配信元のページを開く</summary>
            <p>外部サイトが開きます。広告が表示される場合があります。</p>
            <a
              className="button secondary"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (!read) onRead();
              }}
            >
              元の記事を読む（外部・広告あり）
              <ExternalLink size={16} />
            </a>
            <div className="reader-tip">
              <p>
                iPhoneの「設定」→「アプリ」→「Safari」→「リーダー」で「すべてのウェブサイト」をオンにすると、対応ページを本文中心の表示で開けます。
              </p>
              <p>
                元記事のページメニューから「リーダーを表示」も選べます。非対応のページでは使えず、すべての広告を除去できる機能ではありません。ロムノアから自動でオンにはできません。
              </p>
              <a
                className="text-button"
                href="https://support.apple.com/ja-jp/guide/iphone/iphdc30e3b86/ios"
                target="_blank"
                rel="noopener noreferrer"
              >
                Appleの設定手順を見る
                <ExternalLink size={14} />
              </a>
            </div>
          </details>
          <p className="rights-note">
            個人用プレビューの読書表示です。配信元の文章・画像の権利は各権利者に帰属します。
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
