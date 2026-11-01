// List photo-feature URLs of current Yahoo RSS articles, optionally filtered
// by host: npx tsx scripts/collect-features.ts [host-substring]
import { yahooCategories } from "../src/lib/yahoo-model.js";
import { fetchYahooFeed } from "../server/yahoo.js";
import { fetchPhotoHtml, parseYahooPhotoMetadata } from "../server/yahoo-photos.js";
const filter = process.argv[2] || "";
const articles = new Set<string>();
for (const c of yahooCategories)
  try {
    for (const a of await fetchYahooFeed(c.id)) articles.add(a.url);
  } catch {
    /* skip category */
  }
const queue = [...articles];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const a = queue.shift()!;
      try {
        const meta = parseYahooPhotoMetadata(await fetchPhotoHtml(a), a);
        for (const f of meta.features)
          if (f.url.includes(filter)) console.log(`${a}\t${f.url}\t${f.title.slice(0, 40)}`);
      } catch {
        /* skip article */
      }
    }
  }),
);
