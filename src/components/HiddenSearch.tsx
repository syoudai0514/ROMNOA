import { useLayoutEffect, useRef, useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { hiddenGroupsSchema, type HiddenGroups } from "../lib/hidden-model";
export function HiddenUnlock({
  onUnlock,
  onClose,
}: {
  onUnlock: (groups: HiddenGroups) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="hidden-unlock"
      aria-label="隠しメニューのパスワード"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <LockKeyhole size={20} />
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="パスワード画面を閉じる"
        >
          <X size={19} />
        </button>
      </header>
      <h2>パスワードを入力</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (loading || !/^\d{6}$/.test(pin)) return;
          setLoading(true);
          setError("");
          try {
            const r = await fetch("/api/hidden-search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pin }),
              signal: AbortSignal.timeout(10000),
            });
            const body = await r.json();
            if (!r.ok) {
              setError(
                r.status === 429
                  ? "少し時間をおいてお試しください。"
                  : "パスワードを確認してください。",
              );
              return;
            }
            const groups = hiddenGroupsSchema.parse(body.groups);
            setPin("");
            onUnlock(groups);
          } catch {
            setError("開けませんでした。接続を確認してください。");
          } finally {
            setLoading(false);
          }
        }}
      >
        <input
          aria-label="隠しメニューのパスワード"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <button
          className="button primary"
          disabled={loading || pin.length !== 6}
        >
          {loading ? "確認中" : "開く"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
export function HiddenSearch({
  groups,
  onSearch,
  onClose,
}: {
  groups: HiddenGroups;
  onSearch: (query: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="hidden-search-panel" aria-label="隠し検索">
      <header>
        <div>
          <span className="eyebrow">STYLE & PHOTO</span>
          <h2>気になる雰囲気から。</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="隠し検索を閉じる"
        >
          <X size={19} />
        </button>
      </header>
      <p>
        大人のファッション・写真集を探すヒント。開いた記事の履歴・保存は通常の機能と共通です。
      </p>
      <p className="verified-hints">
        複数の記事が見つかった候補だけを掲載しています（2026/10/28確認）。
      </p>
      {groups.map((group) => (
        <div className="hidden-word-group" key={group.title}>
          <h3>{group.title}</h3>
          <div>
            {group.words.map((word) => (
              <button key={word.query} onClick={() => onSearch(word.query)}>
                {word.label}
                <small>{word.verifiedCount}件以上を確認</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
