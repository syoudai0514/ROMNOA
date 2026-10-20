import { describe, expect, it, vi } from "vitest";
import { MAX_BYTES, normalizeUrl, parseFeed } from "../server/parser";
import { fetchFeed } from "../server/feed-service";
import { sources, type Source } from "../server/sources";
import { handleArticles } from "../server/handler";
import { feed } from "./fixtures";
import { feedResponseSchema } from "../src/lib/model";

const source = sources[0];
const item =
  '<item><title><![CDATA[<img src=x onerror=alert(1)>安全な記事<script>alert(2)</script>]]></title><link>http://hamusoku.com/archives/1.html?utm_source=x#part</link><pubDate>Tue, 20 Oct 2026 12:00:00 +0900</pubDate><description><![CDATA[秘密の全文<img src="https://tracker.invalid/a">]]></description></item>';
const rss = (body = item) =>
  `<rss version="2.0"><channel><title>test</title>${body}</channel></rss>`;

describe("RSS and URL security (R01/R05/R10)", () => {
  it("strips markup and does not distribute body, images, or tracker data", () => {
    const a = parseFeed(rss(), source)[0];
    expect(a.title).toBe("安全な記事");
    expect(a.url).toBe("https://hamusoku.com/archives/1.html");
    expect(a.publishedAt).toBe("2026-10-20T03:00:00.000Z");
    expect(JSON.stringify(a)).not.toMatch(
      /秘密|tracker|onerror|script|description/,
    );
  });
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://127.0.0.1/",
    "https://hamusoku.com.evil.test/a",
    "https://hamusoku.com@evil.test/a",
    "https://hamusoku.com:8080/a",
    "https://alfalfalfa.com/a",
  ])("rejects unsafe or off-source link: %s", (url) => {
    expect(normalizeUrl(url, source)).toBeNull();
  });
  it("rejects external entities and expansion attacks before parsing", () => {
    expect(() =>
      parseFeed(
        '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + rss(),
        source,
      ),
    ).toThrow("xml_declaration_blocked");
    expect(() => parseFeed('<!ENTITY a "aaaa">' + rss(), source)).toThrow(
      "xml_declaration_blocked",
    );
  });
  it("rejects malformed, empty, unsupported and oversized feeds", () => {
    expect(() => parseFeed("<rss><channel></rss>", source)).toThrow(
      "invalid_xml",
    );
    expect(() => parseFeed("<html></html>", source)).toThrow(
      "unsupported_feed",
    );
    expect(() => parseFeed(rss(""), source)).toThrow("empty_feed");
    expect(() => parseFeed("a".repeat(MAX_BYTES + 1), source)).toThrow(
      "feed_too_large",
    );
  });
  it("handles RDF and Atom, deduplicates normalized URLs and preserves unknown dates", () => {
    expect(
      parseFeed(`<rdf:RDF xmlns:rdf="x">${item}${item}</rdf:RDF>`, source),
    ).toHaveLength(1);
    const a = parseFeed(
      '<feed><entry><title>Atom entry</title><link rel="alternate" href="https://hamusoku.com/archives/2.html"/><updated>bad</updated><category term="ゲーム"/></entry></feed>',
      source,
    )[0];
    expect(a.category).toBe("ゲーム");
    expect(a.publishedAt).toBeNull();
  });
  it("enforces the server allowlist before calling fetch", async () => {
    const fetcher = vi.fn();
    await expect(
      fetchFeed(
        { ...source, url: "http://127.0.0.1/" } as unknown as Source,
        fetcher,
      ),
    ).rejects.toThrow("source_not_allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("blocks redirects and limits the decompressed stream even without content-length", async () => {
    const fetcher = vi.fn(
      async (_: unknown, options: RequestInit | undefined) => {
        expect(options?.redirect).toBe("error");
        expect(options?.signal).toBeDefined();
        return new Response(new Uint8Array(MAX_BYTES + 1));
      },
    );
    await expect(fetchFeed(source, fetcher as typeof fetch)).rejects.toThrow(
      "feed_too_large",
    );
  });
  it("refuses URL query proxy requests and unsupported methods before collection", async () => {
    const service = { get: vi.fn(async () => feed) };
    expect(
      (
        await handleArticles(
          new Request("https://romnoa.test/api/articles?url=http://127.0.0.1"),
          service,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleArticles(
          new Request("https://romnoa.test/api/articles", { method: "POST" }),
          service,
        )
      ).status,
    ).toBe(405);
    expect(service.get).not.toHaveBeenCalled();
  });
  it("validates browser cached article URLs and source identity", () => {
    expect(feedResponseSchema.safeParse(feed).success).toBe(true);
    expect(
      feedResponseSchema.safeParse({
        ...feed,
        articles: [{ ...feed.articles[0], url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
    expect(
      feedResponseSchema.safeParse({
        ...feed,
        articles: [{ ...feed.articles[0], sourceId: "alfalfa" }],
      }).success,
    ).toBe(false);
  });
});
