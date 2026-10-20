import { XMLParser, XMLValidator } from "fast-xml-parser";
import sanitizeHtml from "sanitize-html";
import { classify, newest, type Article } from "../src/lib/model.js";
import type { Source } from "./sources.js";

export const MAX_BYTES = 1_000_000;
type Node = Record<string, unknown>;
const list = (x: unknown): unknown[] =>
  x == null ? [] : Array.isArray(x) ? x : [x];
const object = (x: unknown): Node =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Node) : {};
function string(x: unknown): string {
  if (typeof x === "string" || typeof x === "number") return String(x);
  return typeof object(x)["#text"] === "string"
    ? (object(x)["#text"] as string)
    : "";
}
function plain(x: unknown) {
  return sanitizeHtml(string(x), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(raw: string, source: Source): string | null {
  try {
    const u = new URL(raw);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.hostname !== source.hostname ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    u.protocol = "https:";
    u.hash = "";
    [...u.searchParams.keys()].forEach((k) => {
      if (/^utm_|^(fbclid|gclid|ref)$/i.test(k)) u.searchParams.delete(k);
    });
    u.searchParams.sort();
    return u.toString();
  } catch {
    return null;
  }
}

export function parseFeed(xml: string, source: Source): Article[] {
  if (Buffer.byteLength(xml, "utf8") > MAX_BYTES)
    throw new Error("feed_too_large");
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error("xml_declaration_blocked");
  if (XMLValidator.validate(xml) !== true) throw new Error("invalid_xml");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
    htmlEntities: false,
  }).parse(xml);
  const rss = object(parsed.rss),
    rdf = object(parsed["rdf:RDF"]),
    atom = object(parsed.feed);
  const root = Object.keys(rdf).length
    ? rdf
    : Object.keys(rss).length
      ? object(rss.channel)
      : atom;
  if (!Object.keys(root).length) throw new Error("unsupported_feed");
  const records = list(root.item ?? root.entry).slice(0, 100);
  const articles: Article[] = [];
  for (const raw of records) {
    const item = object(raw);
    const link = list(item.link).find(
      (l) =>
        typeof l === "string" ||
        !object(l)["@_rel"] ||
        object(l)["@_rel"] === "alternate",
    );
    const url = normalizeUrl(
      string(link) || string(object(link)["@_href"]),
      source,
    );
    const title = plain(item.title).slice(0, 300);
    if (!url || !title) continue;
    const date = string(
      item.pubDate ?? item["dc:date"] ?? item.published ?? item.updated,
    );
    const ms = date ? Date.parse(date) : NaN;
    const category = list(item.category ?? item["dc:subject"])
      .map((c) => plain(object(c)["@_term"] ?? c))
      .join(" ");
    // Intentionally never read description, content:encoded, media, or embedded HTML.
    articles.push({
      id: url,
      url,
      sourceId: source.id,
      title,
      category: classify(`${category} ${title}`),
      publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    });
  }
  if (!articles.length) throw new Error("empty_feed");
  return [...new Map(articles.map((a) => [a.id, a])).values()].sort(newest);
}
