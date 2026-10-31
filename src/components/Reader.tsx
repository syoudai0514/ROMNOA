import { compactReaderText } from "../lib/reader-layout";
import { SocialPostCard } from "./SocialPost";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import { articleDate, sourceInfo, type Article } from "../lib/model";
import { readerPictures } from "../lib/reader-model";
import { readerVideos, readerSocialPosts } from "../lib/reader-media";
import { ArticleVideos } from "./ArticleVideos";
import { useReader } from "../lib/use-reader";
import { ReaderText } from "./ReaderText";
import { ArticleImages, ImageViewer } from "./ArticleImages";

export function Reader({
  article,
  bottomNav,
  channelSwitch,
  saved,
  read,
  index,
  total,
  onClose,
  onSave,
  onRead,
  onMove,
  from,
  collection,
  onRelated,
  onBack,
  hiddenSources,
  ngWords,
}: {
  article: Article;
  bottomNav?: React.ReactNode;
  channelSwitch?: React.ReactNode;
  saved: boolean;
  read: boolean;
  index: number;
  total: number;
  onClose: () => void;
  onSave: () => void;
  onRead: () => void;
  onMove: (delta: number) => void;
  from?: string;
  collection?: string;
  onRelated: (article: Article) => void;
  onBack?: () => void;
  hiddenSources: string[];
  ngWords: string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const source = sourceInfo.find((s) => s.id === article.sourceId)!;
  const reading = useReader(article.id, from, collection, saved);
  const [textFor, setTextFor] = useState<Set<string>>(() => new Set());
  const allPictures = reading.document ? readerPictures(reading.document) : [];
  const bodyPictures = allPictures.filter((b) => b.role !== "cover");
  const pictures = bodyPictures.length ? bodyPictures : allPictures;
  const videos = reading.document ? readerVideos(reading.document) : [];
  const socialPosts = reading.document
    ? readerSocialPosts(reading.document)
    : [];
  const videoElements = useRef<Record<string, HTMLVideoElement | null>>({});
  const [videoNotice, setVideoNotice] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const roundup = reading.document?.pageKind === "roundup";
  const [expandedImage, setExpandedImage] = useState<{
    articleId: string;
    url: string;
  } | null>(null);
  const expandedIndex =
    expandedImage?.articleId === article.id
      ? pictures.findIndex((picture) => picture.url === expandedImage.url)
      : -1;
  const related =
    reading.document?.related.filter(
      (r) =>
        !hiddenSources.includes(r.article.sourceId) &&
        !ngWords.some((word) =>
          r.article.title
            .toLocaleLowerCase()
            .includes(word.toLocaleLowerCase()),
        ),
    ) || [];
  const positions = useRef<Record<string, number>>({});
  const restoring = useRef(false);
  function rememberPosition() {
    if (!reading.document || !content.current) return;
    positions.current[article.id] = content.current.scrollTop;
    try {
      sessionStorage.setItem(
        `romnoa:detail:${article.id}`,
        String(content.current.scrollTop),
      );
    } catch {
      /* optional persistence */
    }
  }
  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    d.querySelector<HTMLButtonElement>(".reader-back")?.focus();
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
      restoring.current = positions.current[article.id] > 0;
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
    const el = content.current;
    if (!reading.document || !el) return;
    const target = positions.current[article.id] || 0;
    if (!target) {
      restoring.current = false;
      el.scrollTop = 0;
      return;
    }
    // Image heights arrive asynchronously. Keep restoring until layout settles,
    // but immediately give control back when the user touches or scrolls.
    restoring.current = true;
    const restore = () => {
      if (restoring.current) el.scrollTop = target;
    };
    const observer = new ResizeObserver(restore);
    const finish = () => {
      restoring.current = false;
      observer.disconnect();
    };
    const timer = setTimeout(finish, 8000);
    el.querySelectorAll(".reading-body, .reader-related").forEach((node) =>
      observer.observe(node),
    );
    el.addEventListener("load", restore, true);
    el.addEventListener("pointerdown", finish, { passive: true });
    el.addEventListener("touchstart", finish, { passive: true });
    el.addEventListener("wheel", finish, { passive: true });
    restore();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      el.removeEventListener("load", restore, true);
      el.removeEventListener("pointerdown", finish);
      el.removeEventListener("touchstart", finish);
      el.removeEventListener("wheel", finish);
    };
  }, [reading.document, article.id]);
  return (
    <dialog
      ref={dialog}
      className="reader"
      aria-labelledby="reader-title"
      onCancel={() => {
        rememberPosition();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          rememberPosition();
          onClose();
        }
      }}
    >
      {expandedIndex >= 0 && (
        <ImageViewer
          key={`${article.id}:${expandedImage!.url}`}
          pictures={pictures}
          initial={expandedIndex}
          onClose={() => setExpandedImage(null)}
        />
      )}
      {bottomNav}
      <div className="reader-inner">
        <header className="reader-toolbar">
          <button
            className="button quiet reader-back"
            aria-label={onBack ? "元の記事へ戻る" : "記事を閉じる"}
            onClick={() => {
              rememberPosition();
              if (onBack) onBack();
              else onClose();
            }}
            autoFocus
          >
            <ArrowLeft size={17} />
            戻る
          </button>
          {channelSwitch}
        </header>
        <div
          className="reader-content"
          ref={content}
          onScroll={(e) => {
            if (!reading.document || restoring.current) return;
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
            <a
              className="button secondary reader-source-link"
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="元ページを開く"
              onClick={rememberPosition}
            >
              元ページ
              <ExternalLink size={16} />
            </a>
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
          <p className="external-link-note">
            元ページや外部リンクでは広告が表示される場合があります。
          </p>
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
              {roundup ? (
                <div className="roundup-note">
                  <strong>記事への案内ページです</strong>
                  <p>
                    紹介画像の一覧です。下のタイトルから本編の画像・本文を開けます。
                  </p>
                </div>
              ) : (
                <>
                  <div className="image-classification">
                    <strong>
                      この記事の画像 {pictures.length}枚
                      {videos.length > 0 ? `・動画 ${videos.length}本` : ""}
                    </strong>
                    <details>
                      <summary>画像の判定について</summary>
                      <p>
                        本文内の掲載位置・画像の配信元・リンク先から選別しています。
                      </p>
                      <p>
                        本文内で広告・誘導と判定：
                        {reading.document.imageAudit.excluded}
                        枚除外／別記事への画像：
                        {reading.document.imageAudit.related}枚分離／判定保留：
                        {reading.document.imageAudit.uncertain}
                        枚非表示。画像の内容と見出しの一致を保証する判定ではありません。
                      </p>
                    </details>
                  </div>
                  {videos.length > 0 && (
                    <ArticleVideos
                      videos={videos}
                      onElement={(url, element) => {
                        videoElements.current[url] = element;
                      }}
                    />
                  )}
                  {videoNotice?.id === article.id && (
                    <p role="status" className="video-notice">
                      {videoNotice.text}
                    </p>
                  )}
                  {pictures.length > 0 ? (
                    <ArticleImages key={article.id} pictures={pictures} />
                  ) : videos.length === 0 && socialPosts.length === 0 ? (
                    <p className="reader-image-placeholder">
                      この記事で表示できる画像は見つかりませんでした。判定保留の画像は読み込んでいません。
                    </p>
                  ) : null}
                  {socialPosts.length > 0 && (
                    <section className="social-posts" aria-label="SNSの投稿">
                      {socialPosts.map((post) => (
                        <SocialPostCard
                          key={post.url}
                          url={post.url}
                          provider={post.provider}
                        />
                      ))}
                    </section>
                  )}
                  {(pictures.length > 0 || videos.length > 0) && (
                    <button
                      className="button secondary body-toggle"
                      aria-expanded={textFor.has(article.id)}
                      onClick={() =>
                        setTextFor((previous) => {
                          const next = new Set(previous);
                          if (next.has(article.id)) next.delete(article.id);
                          else next.add(article.id);
                          return next;
                        })
                      }
                    >
                      {textFor.has(article.id) ? "本文を閉じる" : "本文も読む"}
                    </button>
                  )}
                  {(textFor.has(article.id) ||
                    (!pictures.length && !videos.length)) &&
                    reading.document.blocks.map((block, i) =>
                      block.type === "text" ? (
                        <p key={i} className="reader-text-block">
                          <ReaderText
                            text={compactReaderText(block.text)}
                            links={reading.document!.links}
                            sourceId={article.sourceId}
                            imageUrls={pictures.map((picture) => picture.url)}
                            onImageOpen={(url) =>
                              setExpandedImage({ articleId: article.id, url })
                            }
                            articles={related.map((item) => item.article)}
                            onArticleOpen={(next) => {
                              rememberPosition();
                              onRelated(next);
                            }}
                            videoUrls={videos.map((video) => video.url)}
                            onVideoOpen={(url) => {
                              const element = videoElements.current[url];
                              if (!element) {
                                setVideoNotice({
                                  id: article.id,
                                  text: "動画を読み込めませんでした。プレーヤーの再読み込みをお試しください。",
                                });
                                content.current
                                  ?.querySelector(".article-videos")
                                  ?.scrollIntoView({ block: "center" });
                                return;
                              }
                              element.scrollIntoView({ block: "center" });
                              element.focus({ preventScroll: true });
                              void element
                                .play()
                                .then(() => setVideoNotice(null))
                                .catch(() =>
                                  setVideoNotice({
                                    id: article.id,
                                    text: "動画プレーヤーの再生ボタンを押してください。",
                                  }),
                                );
                            }}
                          />
                        </p>
                      ) : null,
                    )}
                  {bodyPictures.length > 0 &&
                    allPictures.length > bodyPictures.length && (
                      <p className="image-source-note">
                        見出し用の画像を除き、本文に掲載された画像を表示しています。
                      </p>
                    )}
                </>
              )}
              {reading.storageError && (
                <p className="reader-storage-warning" role="status">
                  本文を端末に保存できませんでした。この画面では引き続き読めます。
                </p>
              )}
            </section>
          )}
          {reading.document && (
            <section className="reader-related" aria-label="ほかのまとめ">
              <h2>
                {roundup
                  ? "この一覧の記事を開く"
                  : "気になるまとめを、もうひとつ"}
              </h2>
              <p>別の記事です。タップするとアプリ内で開きます。</p>
              {related.length ? (
                related.map(({ article: next, thumbnail }) => (
                  <div className="related-card" key={next.id}>
                    <button
                      className="related-open"
                      onClick={() => {
                        rememberPosition();
                        onRelated(next);
                      }}
                    >
                      {thumbnail && (
                        <img
                          src={thumbnail}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                        />
                      )}
                      <span>
                        <small>
                          {roundup ? "本編をアプリ内で開く" : "別の記事"} ·{" "}
                          {sourceInfo.find((s) => s.id === next.sourceId)?.name}
                        </small>
                        <strong>{next.title}</strong>
                      </span>
                      <ArrowRight size={17} />
                    </button>
                    <a
                      className="related-original icon-button"
                      href={next.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`元ページを開く：${next.title}`}
                      title="元ページを開く（外部）"
                      onClick={rememberPosition}
                    >
                      <ExternalLink size={17} />
                    </a>
                  </div>
                ))
              ) : (
                <p>このページから開ける関連記事はありません。</p>
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
            配信元の文章・画像の権利は各権利者に帰属します。
          </p>
        </div>
        <footer className="reader-footer">
          <button
            className="button quiet"
            disabled={index <= 0}
            onClick={() => {
              rememberPosition();
              onMove(-1);
            }}
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
            onClick={() => {
              rememberPosition();
              onMove(1);
            }}
          >
            次の記事
            <ArrowRight size={18} />
          </button>
        </footer>
      </div>
    </dialog>
  );
}
