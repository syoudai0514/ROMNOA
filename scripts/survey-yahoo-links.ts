// Survey every link in current Yahoo News articles and how ROMNOA handles it.
//   NODE_USE_ENV_PROXY=1 npx tsx scripts/survey-yahoo-links.ts [out-dir] [--save-html]
// Writes links.json (every link, its classification and gallery result) and
// summary.md (grouped by host + path shape). With --save-html the pages whose
// gallery could not be resolved are saved for writing fixtures. Saved pages are
// publisher content: keep them out of Git unless reduced to a minimal fixture.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { yahooCategories } from "../src/lib/yahoo-model.js";
import { classifyPhotoLink } from "../src/lib/photo-link-classifier.js";
import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model.js";
import { fetchYahooFeed } from "../server/yahoo.js";
import {
  fetchPhotoHtml,
  MemoryPhotoCache,
  YahooPhotoService,
} from "../server/yahoo-photos.js";

const out = process.argv.slice(2).find((a) => !a.startsWith("--")) || "survey";
const saveHtml = process.argv.includes("--save-html");
mkdirSync(out, { recursive: true });

type Row = {
  article: string;
  category: string;
  source: "richBody" | "paragraph" | "related";
  label: string;
  url: string;
  kind: string;
  score: number;
  feature: boolean;
  result?: { pages: number; title: string } | { error: string };
};

function links(html: string) {
  const m = html.match(
    /<script[^>]*>\s*window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
  );
  if (!m) return [];
  const detail = JSON.parse(m[1]).articleDetail || {};
  const found: { source: Row["source"]; label: string; url: string }[] = [];
  const visit = (node: any): string => {
    if (!node || typeof node !== "object") return "";
    const text =
      typeof node.value === "string"
        ? node.value
        : (node.children || []).map(visit).join("");
    if (node.tagName === "a" && typeof node.attributes?.href === "string")
      found.push({
        source: "richBody",
        label: text,
        url: node.attributes.href,
      });
    return text;
  };
  (detail.richBody || []).forEach(visit);
  for (const p of detail.paragraphs || [])
    for (const t of p.textDetails || []) {
      if (t.link?.linkURL)
        found.push({
          source: "paragraph",
          label: t.link.linkText || "",
          url: t.link.linkURL,
        });
      for (const part of t.paragraphItems || [])
        if (part.link?.linkURL)
          found.push({
            source: "paragraph",
            label: part.link.linkText || part.text || "",
            url: part.link.linkURL,
          });
    }
  for (const r of detail.relatedLink || [])
    if (r.uri)
      found.push({ source: "related", label: r.title || "", url: r.uri });
  return found;
}

// Group links by shape: digits → N, long hex → H, so one row per URL format.
const shape = (raw: string) => {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .replace(/[a-f0-9]{16,}/gi, "H")
      .replace(/\d+/g, "N");
    const query = [...u.searchParams.keys()]
      .filter((k) => !k.startsWith("utm_"))
      .sort()
      .join("&");
    return `${u.hostname}${path}${query ? `?${query}` : ""}`;
  } catch {
    return "invalid";
  }
};

const articles = new Map<string, string>();
for (const c of yahooCategories) {
  try {
    for (const a of await fetchYahooFeed(c.id)) articles.set(a.url, c.id);
  } catch (e) {
    console.error("feed", c.id, String(e));
  }
}
console.error(`articles: ${articles.size}`);

const service = new YahooPhotoService(new MemoryPhotoCache());
const rows: Row[] = [];
const queue = [...articles];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const [article, category] = queue.shift()!;
      let found: ReturnType<typeof links> = [];
      try {
        found = links(await fetchPhotoHtml(article));
      } catch (e) {
        console.error("article", article, String(e));
        continue;
      }
      let features: string[] = [];
      try {
        const meta = await service.get(article);
        if (meta.kind === "article") features = meta.features.map((f) => f.url);
      } catch {
        /* recorded per link below */
      }
      for (const link of found) {
        const target = linkedPhotoTarget(link.url)?.url || link.url;
        const row: Row = {
          article,
          category,
          ...link,
          ...classifyPhotoLink(link.url, link.label),
          feature: features.includes(target),
        };
        if (row.feature) {
          try {
            const g = await service.get(article, target);
            row.result =
              g.kind === "gallery"
                ? { pages: g.pages.length, title: g.title }
                : { error: "not_gallery" };
          } catch (e) {
            row.result = { error: e instanceof Error ? e.message : String(e) };
            if (saveHtml)
              try {
                writeFileSync(
                  join(out, `${shape(target).replace(/[^\w.-]+/g, "_")}.html`),
                  await fetchPhotoHtml(target),
                );
              } catch {
                /* the fetch itself failed */
              }
          }
        }
        rows.push(row);
      }
      console.error(`${articles.size - queue.length}/${articles.size}`);
    }
  }),
);
writeFileSync(join(out, "links.json"), JSON.stringify(rows, null, 2));

const groups = new Map<string, Row[]>();
for (const r of rows) {
  const k = shape(r.url);
  groups.set(k, [...(groups.get(k) || []), r]);
}
const lines = [
  `# Yahoo link survey ${new Date().toISOString()}`,
  "",
  `articles ${articles.size} / links ${rows.length} / features ${rows.filter((r) => r.feature).length}`,
  "",
  "| URL shape | links | kind | features | resolved | photos (max) | errors | example label |",
  "|---|---|---|---|---|---|---|---|",
];
for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const tried = list.filter((r) => r.result);
  const ok = tried.filter((r) => r.result && "pages" in r.result);
  const errors = [
    ...new Set(
      tried.flatMap((r) =>
        r.result && "error" in r.result ? [r.result.error] : [],
      ),
    ),
  ];
  const kinds = [...new Set(list.map((r) => r.kind))].join(",");
  const max = Math.max(
    0,
    ...ok.map((r) => (r.result && "pages" in r.result ? r.result.pages : 0)),
  );
  lines.push(
    `| ${k} | ${list.length} | ${kinds} | ${list.filter((r) => r.feature).length} | ${ok.length}/${tried.length} | ${max} | ${errors.join(" ")} | ${list[0].label.slice(0, 40).replace(/\|/g, "/")} |`,
  );
}
writeFileSync(join(out, "summary.md"), lines.join("\n") + "\n");
console.error(`wrote ${join(out, "summary.md")}`);
