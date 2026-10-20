import { describe, expect, it, vi } from "vitest";
import { FeedService, INTERVAL, MemoryCache } from "../server/feed-service";
import { handleArticles } from "../server/handler";
import { article } from "./fixtures";

describe("Collection resilience (R01/R02)", () => {
  it("keeps a working source when another fails and coalesces simultaneous requests", async () => {
    const load = vi.fn(async (s) => {
      if (s.id === "alfalfa") throw new Error("unavailable");
      return [article()];
    });
    const service = new FeedService(new MemoryCache(), load);
    const [first, second] = await Promise.all([service.get(), service.get()]);
    expect(first.articles).toHaveLength(1);
    expect(second.articles).toEqual(first.articles);
    expect(first.sources.map((s) => s.status)).toEqual(["ok", "error"]);
    expect(load).toHaveBeenCalledTimes(2);
    await service.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("serves stale content after a failure and expires it after 24 hours", async () => {
    let now = Date.parse("2026-10-20T03:00:00Z");
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return [article()];
    });
    const service = new FeedService(new MemoryCache(), load, () => now);
    await service.get();
    fail = true;
    now += INTERVAL + 1;
    const stale = await service.get();
    expect(stale.articles).toHaveLength(1);
    expect(stale.sources[0].status).toBe("cached");
    await service.get();
    expect(load).toHaveBeenCalledTimes(4);
    now += 86_400_000;
    const expired = await service.get();
    expect(expired.articles).toHaveLength(0);
    expect(expired.sources[0].status).toBe("error");
  });
  it("returns 503/no-store for total failure and catches unexpected aggregation failures", async () => {
    const service = new FeedService(new MemoryCache(), async () => {
      throw new Error("fail");
    });
    const res = await handleArticles(
      new Request("https://test/api/articles"),
      service,
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe("no-store");
    expect(
      (
        await handleArticles(new Request("https://test/api/articles"), {
          get: async () => {
            throw new Error("broken");
          },
        })
      ).status,
    ).toBe(503);
  });
  it("continues when the shared cache is unavailable", async () => {
    const service = new FeedService(
      {
        get: async () => {
          throw new Error("cache");
        },
        set: async () => {
          throw new Error("cache");
        },
      },
      async () => [article()],
    );
    expect((await service.get()).articles).toHaveLength(1);
  });
});
