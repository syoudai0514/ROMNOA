import { feedService, type FeedService } from "./feed-service.js";

export async function handleArticles(
  req: Request,
  service: Pick<FeedService, "get"> = feedService,
) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
  if (req.method !== "GET")
    return Response.json(
      { error: "GETのみ利用できます。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  if (new URL(req.url).search)
    return Response.json(
      { error: "クエリは指定できません。" },
      { status: 400, headers },
    );
  try {
    const data = await service.get();
    const failed = !data.articles.length;
    return Response.json(data, {
      status: failed ? 503 : 200,
      headers: {
        ...headers,
        "Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": failed
          ? "no-store"
          : "public, max-age=600, stale-while-revalidate=86400",
      },
    });
  } catch {
    console.error("ROMNOA aggregation_failed");
    return Response.json(
      { error: "取得に失敗しました。時間をおいてお試しください。" },
      { status: 503, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}
