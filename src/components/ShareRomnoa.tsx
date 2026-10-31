import { useState } from "react";
import { Share2, ExternalLink, Copy } from "lucide-react";

export const ROMNOA_SHARE_TEXT = `ROMNOA（ロムノア）— Read freely.

ニュースやまとめを、自分のペースで読めるアプリです。
・ニュースとまとめをワンタップで切り替え
・気になる記事を検索して、お気に入りに保存
・対応する記事は本文や写真・動画をアプリ内で閲覧

使い方
1. 下のリンクを開く
2. 上部の「ニュース」「まとめ」を選ぶ
3. 気になる記事をタップ。後で読む記事はしおりで保存

ホーム画面に追加すると、アプリのように開けます。
iPhone：Safariで開き、共有 →「ホーム画面に追加」
Android：Chromeで開き、︙ →「ホーム画面に追加」（または「アプリをインストール」）

保存・既読・設定は端末ごとに保存されます。
https://romnoa.vercel.app/`;

export function ShareRomnoa() {
  const [notice, setNotice] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(ROMNOA_SHARE_TEXT);
      setNotice("紹介文をコピーしました。LINEなどに貼り付けて送れます。");
    } catch {
      setNotice(
        "コピーできませんでした。紹介文を長押ししてコピーしてください。",
      );
    }
  }
  async function share() {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: "ROMNOAの紹介", text: ROMNOA_SHARE_TEXT });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        await copy();
    }
  }
  return (
    <section className="settings-card share-romnoa">
      <div className="settings-title">
        <Share2 size={19} />
        <h2>ROMNOAを紹介する</h2>
      </div>
      <p className="setting-help">紹介文と使い方を、LINEなどで共有できます。</p>
      <label>
        紹介文・使い方
        <textarea
          aria-label="ROMNOAの紹介文と使い方"
          readOnly
          rows={12}
          value={ROMNOA_SHARE_TEXT}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <div className="share-romnoa-actions">
        <a
          className="button primary"
          href={`https://line.me/R/msg/text/?${encodeURIComponent(ROMNOA_SHARE_TEXT)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          LINEで送る <ExternalLink size={15} />
        </a>
        <button className="button secondary" onClick={() => void share()}>
          <Share2 size={16} />
          共有する
        </button>
        <button className="button secondary" onClick={() => void copy()}>
          <Copy size={16} />
          コピー
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
