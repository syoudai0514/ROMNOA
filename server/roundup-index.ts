import { createHash } from "node:crypto";
import { DomUtils } from "htmlparser2";
import { z } from "zod";
import {
  articleSchema,
  sourceInfo,
  newest,
  type Article,
} from "../src/lib/model.js";
import { japanDay } from "../src/lib/discovery-model.js";
import { matchesSearch, type SearchScope } from "../src/lib/search-model.js";
import { parseIndexMetadata } from "./discovery.js";
import {
  archiveConfigured,
  blobStore,
  type ArchiveStore,
} from "./news-archive.js";
import { fetchPublicPhoto } from "./public-photo-fetch.js";
import { searchTextService } from "./search-content.js";

export const FIRST_ARCHIVE_MONTH = "2005-01";
type Source = Article["sourceId"];
const sources: Source[] = ["hamusoku", "alfalfa"];
const pageSchema = z.object({
  articles: z.array(articleSchema).max(100),
  next: z.boolean(),
  at: z.number(),
});
type Page = z.infer<typeof pageSchema>;
export function previousMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}
export function archiveCursor(month: string, pages: number[] = [1, 1]) {
  return `${month}:${pages.join(":")}`;
}
export function parseArchiveCursor(cursor: string, from: string, to: string) {
  const m = cursor.match(
    /^(\d{4}-(?:0[1-9]|1[0-2])):(0|[1-9]\d{0,3}):(0|[1-9]\d{0,3})$/,
  );
  if (!m || m[1] < from || m[1] > to || (!Number(m[2]) && !Number(m[3])))
    throw Error("invalid_archive_cursor");
  return { month: m[1], pages: [Number(m[2]), Number(m[3])] };
}
export function parseArchivePage(
  html: string,
  source: Source,
  month: string,
  page: number,
) {
  const parsed = parseIndexMetadata(html, source);
  const title = DomUtils.findOne(
    (n) => n.name === "title",
    parsed.doc.children,
  );
  const [year, mon] = month.split("-").map(Number);
  if (
    !title ||
    !new RegExp(`${year}年0?${mon}月`).test(DomUtils.textContent(title))
  )
    throw Error("archive_structure_changed");
  // Sidebars can repeat current stories: only dates in the requested month belong here.
  const articles = parsed.articles.filter((a) =>
    japanDay(a.publishedAt!).startsWith(month),
  );
  const origin = new URL(sourceInfo.find((s) => s.id === source)!.url).origin;
  const next = DomUtils.findAll(
    (n) => n.name === "a",
    parsed.doc.children,
  ).some((n) => {
    try {
      const u = new URL(n.attribs.href || "", origin);
      return (
        u.origin === origin &&
        u.pathname === `/archives/${month}.html` &&
        u.searchParams.get("p") === String(page + 1) &&
        [...u.searchParams.keys()].every((k) => k === "p")
      );
    } catch {
      return false;
    }
  });
  return { articles, next };
}
export async function fetchArchivePage(
  source: Source,
  month: string,
  page: number,
  fetcher: typeof fetch = fetchPublicPhoto,
) {
  const origin = sourceInfo.find((s) => s.id === source)!.url;
  const res = await fetcher(
    `${origin}archives/${month}.html${page > 1 ? `?p=${page}` : ""}`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "text/html",
        "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
      },
    },
  );
  if (res.status === 404 || res.status === 410) {
    await res.body?.cancel();
    return { articles: [], next: false };
  }
  if (
    !res.ok ||
    !res.body ||
    !/text\/html/.test(res.headers.get("content-type") || "")
  ) {
    await res.body?.cancel();
    throw Error("archive_unavailable");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 2_000_000) throw Error("archive_too_large");
      chunks.push(p.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return parseArchivePage(
    Buffer.concat(chunks).toString("utf8"),
    source,
    month,
    page,
  );
}
export class RoundupIndex {
  private pages = new Map<string, Page>();
  private pending = new Map<string, Promise<Page>>();
  constructor(
    private store: ArchiveStore | null = null,
    private load = fetchArchivePage,
    private now = Date.now,
    private body = (a: Article, signal: AbortSignal) =>
      searchTextService.get(a, signal),
  ) {}
  async page(source: Source, month: string, page: number) {
    if (
      !sources.includes(source) ||
      !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) ||
      month < FIRST_ARCHIVE_MONTH ||
      month > japanDay(this.now()).slice(0, 7) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 9999
    )
      throw Error("invalid_archive_page");
    const key = `roundup-index/v1/${source}/${month}/${page}.json`;
    const fresh = (p: Page) =>
      this.now() - p.at >= 0 &&
      this.now() - p.at <
        (month === japanDay(this.now()).slice(0, 7) ? 600000 : 30 * 86400000);
    const memory = this.pages.get(key);
    if (memory && fresh(memory)) return memory;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = (async () => {
      if (this.store)
        try {
          const raw = await this.store.read(key);
          const parsed = raw && pageSchema.safeParse(JSON.parse(raw));
          if (parsed && parsed.success && fresh(parsed.data)) {
            this.remember(key, parsed.data);
            return parsed.data;
          }
        } catch {
          /* Fetch the public index if optional storage is unavailable. */
        }
      const p = pageSchema.parse({
        ...(await this.load(source, month, page)),
        at: this.now(),
      });
      this.remember(key, p);
      if (this.store)
        try {
          await this.store.write(key, JSON.stringify(p));
        } catch {
          console.error("ROMNOA roundup_index_write_failed");
        }
      return p;
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
  private remember(key: string, page: Page) {
    this.pages.delete(key);
    this.pages.set(key, page);
    if (this.pages.size > 128)
      this.pages.delete(this.pages.keys().next().value!);
  }
  async search(
    query: string,
    scope: SearchScope,
    cursor: string | undefined,
    from = `${FIRST_ARCHIVE_MONTH}-01`,
    to = japanDay(this.now()),
  ) {
    const start = from.slice(0, 7),
      end = to.slice(0, 7);
    const current = parseArchiveCursor(
      cursor || archiveCursor(end),
      start,
      end,
    );
    const rows = await Promise.all(
      sources.map(async (source, i) => {
        if (!current.pages[i]) return { source, data: null, error: false };
        try {
          return {
            source,
            data: await this.page(source, current.month, current.pages[i]),
            error: false,
          };
        } catch {
          return { source, data: null, error: true };
        }
      }),
    );
    const failed = rows.some((r) => r.error);
    const candidates = [
      ...new Map(
        rows
          .flatMap((r) => r.data?.articles || [])
          .filter(
            (a) =>
              japanDay(a.publishedAt!) >= from &&
              japanDay(a.publishedAt!) <= to,
          )
          .map((a) => [a.id, a]),
      ).values(),
    ];
    let unverified = 0;
    const found = new Set<string>();
    const queue = [...candidates];
    const signal = AbortSignal.timeout(22000);
    await Promise.all(
      Array.from({ length: scope === "body" ? 6 : 1 }, async () => {
        while (queue.length) {
          const a = queue.shift()!;
          if (matchesSearch(a.title, query)) {
            found.add(a.id);
            continue;
          }
          if (scope === "title") continue;
          if (signal.aborted) {
            unverified++;
            continue;
          }
          const text = await this.body(a, signal).catch(() => null);
          if (text === null) unverified++;
          else if (matchesSearch(`${a.title}\n${text}`, query)) found.add(a.id);
        }
      }),
    );
    const pages = current.pages.map((n, i) =>
      !n ? 0 : rows[i].error ? n : rows[i].data?.next ? n + 1 : 0,
    );
    if (pages.some((p) => p > 9999)) throw Error("archive_page_limit");
    // Advance successful sources independently; retain only the failed page.
    const next: string | null = pages.some(Boolean)
      ? archiveCursor(current.month, pages)
      : current.month > start
        ? archiveCursor(previousMonth(current.month))
        : null;
    const collection = `search:${createHash("sha256")
      .update(
        `${query}\n${scope}\narchive\n${cursor || archiveCursor(end)}\n${from}\n${to}`,
      )
      .digest("hex")}`;
    return {
      query,
      scope,
      articles: candidates.filter((a) => found.has(a.id)).sort(newest),
      collection,
      candidateCount: candidates.length,
      unverifiedCount: unverified,
      excludedCount: candidates.length - found.size - unverified,
      sources: rows
        .filter((r, i) => current.pages[i] > 0)
        .map((r) => ({
          id: r.source,
          status: r.error ? ("error" as const) : ("ok" as const),
          fetchedAt: r.data ? new Date(r.data.at).toISOString() : null,
        })),
      archive: {
        cursor: next,
        month: current.month,
        complete: !next,
        failed,
        from,
        to,
        pages: rows.filter((r) => r.data).length,
      },
      generatedAt: new Date(this.now()).toISOString(),
    };
  }
  async record() {
    if (!this.store) throw Error("archive_storage_unavailable");
    const path = "roundup-index/v1/progress.json";
    let cursor = archiveCursor(japanDay(this.now()).slice(0, 7));
    try {
      const raw = await this.store.read(path);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.at && this.now() - d.at < 3000)
          return { cursor: d.cursor, paused: true };
        if (d.cursor) cursor = d.cursor;
        else return { cursor: null, complete: true };
      }
    } catch {
      /* Begin the index if no checkpoint exists. */
    }
    const started = this.now();
    let pages = 0;
    for (let i = 0; i < 4 && this.now() - started < 24000; i++) {
      const c = parseArchiveCursor(
        cursor,
        FIRST_ARCHIVE_MONTH,
        japanDay(this.now()).slice(0, 7),
      );
      const rows = await Promise.all(
        sources.map((s, j) =>
          c.pages[j] ? this.page(s, c.month, c.pages[j]) : null,
        ),
      );
      pages += rows.filter(Boolean).length;
      const next = c.pages.map((p, j) => (p && rows[j]?.next ? p + 1 : 0));
      const following = next.some(Boolean)
        ? archiveCursor(c.month, next)
        : c.month > FIRST_ARCHIVE_MONTH
          ? archiveCursor(previousMonth(c.month))
          : null;
      await this.store.write(
        path,
        JSON.stringify({ cursor: following, at: this.now() }),
      );
      if (!following) return { pages, cursor: null, complete: true };
      cursor = following;
    }
    return { pages, cursor, complete: false };
  }
}
export const roundupIndex = new RoundupIndex(
  archiveConfigured() ? blobStore : null,
);
