// Resolve photo pages with the production resolver and check every listed
// page. Usage: npx tsx scripts/check-photo-pages.ts URL... (or - for stdin)
// Prints: strategy, page count, and per-page whether the page's large photo
// matches its roster thumbnail.
import { readFileSync } from "node:fs";
import { fetchPhotoHtml, resolvePhotoPage } from "../server/yahoo-photos.js";
import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model.js";
import { photoIdentity as photoStem } from "../server/photo-source.js";
import { measurePhotos } from "./image-size.js";

const args = process.argv.slice(2);
const urls = (args[0] === "-" ? readFileSync(0, "utf8").split(/\s+/) : args).filter(Boolean);
const deep = process.env.DEEP !== "0";
for (const raw of urls) {
  const url = linkedPhotoTarget(raw)?.url;
  if (!url) {
    console.log(`SKIP ${raw}`);
    continue;
  }
  try {
    const { strategy, data } = await resolvePhotoPage(await fetchPhotoHtml(url), url);
    if (data.kind !== "gallery") {
      console.log(`${strategy} social ${url}`);
      continue;
    }
    let bad = 0;
    if (deep && !data.pictures?.length && data.pages.length > 1)
      for (const page of data.pages.slice(0, 6)) {
        if (page === url) continue;
        try {
          const r = await resolvePhotoPage(await fetchPhotoHtml(page), page);
          const thumb = data.thumbnails.find((t) => t.pageUrl === page)?.url;
          if (r.data.kind !== "gallery" || !thumb || photoStem(thumb) !== photoStem(r.data.picture.url)) bad++;
        } catch {
          bad++;
        }
      }
    // Measure the shown photo and the gallery's other photos, not only how
    // many were found. Unmeasurable photos are counted, not assumed fine.
    const m = await measurePhotos(data.picture.url, data.pictures ?? [], url);
    console.log(`${strategy} ${data.pages.length}${data.complete === false ? "?" : ""} bad=${bad} ${m.current} small=${m.small}/${m.measured + m.unknown} unknown=${m.unknown} ${url.slice(0, 110)} -> ${data.picture.url.slice(0, 90)}`);
  } catch (e) {
    console.log(`ERR ${e instanceof Error ? e.message : e} ${url.slice(0, 110)}`);
  }
}
