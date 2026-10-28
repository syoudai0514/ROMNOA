import { hiddenCatalog } from "../server/hidden-catalog.js";
import { SearchService, MemorySearchCache } from "../server/search.js";
import { hiddenTitleAllowed } from "../src/lib/hidden-model.js";
// Explicit maintainer check; not part of CI, to avoid repeated publisher load.
const service = new SearchService(
  new MemorySearchCache(),
  undefined,
  Date.now,
  async () => null,
);
const words = hiddenCatalog.flatMap((group) => group.words);
let next = 0,
  failed = false;
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (next < words.length) {
      const word = words[next++];
      const result = await service.get(word.query);
      const count = result.articles.filter((a) =>
        hiddenTitleAllowed(a.title),
      ).length;
      const good = count >= 3 && result.sources.every((s) => s.status === "ok");
      console.log(
        JSON.stringify({
          query: word.query,
          count,
          verified: good,
          checkedAt: new Date().toISOString(),
        }),
      );
      if (!good) failed = true;
    }
  }),
);
if (failed) process.exitCode = 1;
