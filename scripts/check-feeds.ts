import { fetchFeed } from "../server/feed-service";
import { sources } from "../server/sources";
const results = await Promise.allSettled(
  sources.map(async (source) => {
    const articles = await fetchFeed(source);
    console.log(
      JSON.stringify({
        source: source.id,
        count: articles.length,
        newest: articles[0]?.publishedAt,
        url: source.url,
      }),
    );
  }),
);
if (results.some((r) => r.status === "rejected")) {
  results.forEach((r) => {
    if (r.status === "rejected") console.error(r.reason);
  });
  process.exitCode = 1;
}
