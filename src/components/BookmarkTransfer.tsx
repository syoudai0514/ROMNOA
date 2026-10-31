import { useState } from "react";
import { exportBookmarks, importBookmarks } from "../lib/bookmark-transfer";
import type { Preferences } from "../lib/storage";

export function BookmarkTransfer({
  onImported,
}: {
  onImported: (prefs: Preferences) => void;
}) {
  const [exported, setExported] = useState("");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fail = (e: unknown) => {
    setMessage("");
    setError(e instanceof Error ? e.message : "操作できませんでした。");
  };
  function prepare() {
    try {
      const data = exportBookmarks();
      setExported(data);
      setError("");
      const counts = JSON.parse(data) as {
        roundup: unknown[];
        news: unknown[];
      };
      setMessage(
        `引き継ぎデータを作成しました。まとめ ${counts.roundup.length}件、ニュース ${counts.news.length}件。`,
      );
    } catch (e) {
      fail(e);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([exported], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "romnoa-favorites.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function share() {
    const file = new File([exported], "romnoa-favorites.json", {
      type: "application/json",
    });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "ROMNOAのお気に入り" });
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) fail(e);
      }
    } else download();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(exported);
      setError("");
      setMessage("コピーしました。移行先に貼り付けてください。");
    } catch {
      setMessage("");
      setError(
        "コピーできませんでした。下のデータを長押ししてコピーしてください。",
      );
    }
  }
  function restore() {
    try {
      const result = importBookmarks(input);
      onImported(result.prefs);
      setInput("");
      setError("");
      setMessage(
        `取り込みました。保存数：まとめ ${result.roundup}件、ニュース ${result.news}件。`,
      );
    } catch (e) {
      fail(e);
    }
  }
  return (
    <section className="settings-card">
      <div className="settings-title">
        <h2>お気に入りの引き継ぎ</h2>
      </div>
      <p className="setting-help">
        移行元でデータを作り、移行先で取り込みます。まとめとニュースの保存記事が対象です。
      </p>
      <button className="button secondary" onClick={prepare}>
        引き継ぎデータを作成
      </button>
      {exported && (
        <div className="bookmark-transfer-actions">
          <button className="button secondary" onClick={() => void share()}>
            ファイルを共有・保存
          </button>
          <button className="button secondary" onClick={() => void copy()}>
            データをコピー
          </button>
          <label>
            引き継ぎデータ
            <textarea
              aria-label="作成した引き継ぎデータ"
              readOnly
              value={exported}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
        </div>
      )}
      <div className="bookmark-transfer-actions">
        <label>
          ファイルから読み込む
          <input
            aria-label="お気に入りの引き継ぎファイル"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000) {
                fail(Error("データが大きすぎます。"));
                return;
              }
              void file
                .text()
                .then((text) => {
                  setInput(text);
                  setError("");
                  setMessage(
                    "ファイルを読み込みました。取り込むボタンを押してください。",
                  );
                })
                .catch(fail);
              e.target.value = "";
            }}
          />
        </label>
        <label>
          またはデータを貼り付ける
          <textarea
            aria-label="取り込む引き継ぎデータ"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
          />
        </label>
        <button
          className="button primary"
          disabled={!input.trim()}
          onClick={restore}
        >
          お気に入りを取り込む
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
