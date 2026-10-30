// Use the production resolver, then actually fetch/decode first and last images.
// Input: survey links.json. Output and publisher HTML stay outside the repository.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model.js";
import { resolvePhotoPage, fetchPhotoHtml } from "../server/yahoo-photos.js";
import { fetchPhotoImage } from "../server/yahoo-photo-image.js";
const [input, out] = process.argv.slice(2);
if (!input || !out) throw Error("supply links.json and output directory");
mkdirSync(out, { recursive: true });
mkdirSync(join(out, "html"), { recursive: true });
const candidates = new Map<
  string,
  { url: string; labels: string[]; articles: string[] }
>();
for (const row of JSON.parse(readFileSync(input, "utf8"))) {
  if (!["photo", "gallery"].includes(row.kind)) continue;
  const url = linkedPhotoTarget(row.url)?.url;
  if (!url) continue;
  const item = candidates.get(url) || { url, labels: [], articles: [] };
  if (!item.labels.includes(row.label)) item.labels.push(row.label);
  if (!item.articles.includes(row.article)) item.articles.push(row.article);
  candidates.set(url, item);
}
const file = join(out, "results.json");
const results: any[] = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : [];
const finished = new Set(
  process.argv.includes("--refresh") ? [] : results.map((r) => r.url),
);
const queue = [...candidates.values()].filter((r) => !finished.has(r.url));
const pendingCount = queue.length;
let completedCount = 0;
writeFileSync(
  join(out, "targets.json"),
  JSON.stringify([...candidates.values()], null, 2),
);
async function load(url: string) {
  const path = join(
    out,
    "html",
    createHash("sha256").update(url).digest("hex") + ".html",
  );
  if (existsSync(path)) return readFileSync(path, "utf8");
  const html = await fetchPhotoHtml(url);
  writeFileSync(path, html);
  return html;
}
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const target = queue.shift()!;
      const row: any = { ...target, checkedAt: new Date().toISOString() };
      try {
        const { data: g, strategy } = await resolvePhotoPage(
          await load(target.url),
          target.url,
          load,
        );
        row.strategy = strategy;
        row.count = g.pages.length;
        row.posts = g.posts?.length || 0;
        row.expected = Math.max(
          0,
          ...target.labels.map((label) =>
            Number(label.normalize("NFKC").match(/(?:全)?(\d+)枚/)?.[1] || 0),
          ),
        );
        row.status =
          row.expected > row.count
            ? "incomplete"
            : row.count === 1
              ? "single_review"
              : strategy === "generic"
                ? "multiple_review"
                : "roster_verified";
        row.images = [];
        for (const index of [...new Set([0, g.pages.length - 1])]) {
          try {
            const page = g.pages[index];
            const pic = g.pictures?.length
              ? g.pictures[index]
              : page === target.url
                ? g.picture
                : (await resolvePhotoPage(await load(page), page, load)).data
                    .picture;
            const image = await fetchPhotoImage({
              url: pic.url,
              referer: page.split("#")[0],
            });
            const meta = await sharp(image.body).metadata();
            row.images.push({
              index,
              url: pic.url,
              width: meta.width,
              height: meta.height,
              type: image.type,
            });
          } catch (e) {
            row.images.push({
              index,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (row.images.some((x: any) => x.error)) row.status = "image_failed";
      } catch (e) {
        row.status = "failed";
        row.error = e instanceof Error ? e.message : String(e);
      }
      const previousIndex = results.findIndex((r) => r.url === row.url);
      if (previousIndex >= 0) results[previousIndex] = row;
      else results.push(row);
      writeFileSync(file, JSON.stringify(results, null, 2));
      console.error(
        `${++completedCount}/${pendingCount} ${row.status} ${target.url}`,
      );
    }
  }),
);
console.error("audit completed");
