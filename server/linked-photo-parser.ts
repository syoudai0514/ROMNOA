import { Parser } from "htmlparser2";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
import type { YahooPicture } from "../src/lib/yahoo-photos-model.js";

// Extract declared content images, never crawl arbitrary anchors or execute scripts.
export function parseLinkedPhotos(html: string, pageUrl: string) {
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const pictures: YahooPicture[] = [],
    fallback: YahooPicture[] = [];
  const stack: { blocked: boolean; content: boolean }[] = [];
  let title = "",
    inTitle = false,
    nodes = 0;
  const add = (raw: string, alt: string, into = pictures) => {
    const url = publicPhotoUrl(raw, pageUrl);
    if (
      url &&
      !/\.(?:svg|ico)(?:[?#]|$)/i.test(url) &&
      into.length < 40 &&
      !into.some((p) => p.url === url)
    )
      into.push({
        url,
        alt: alt.trim().slice(0, 500),
        caption: alt.trim().slice(0, 500),
      });
  };
  new Parser(
    {
      onopentag(tag, a) {
        if (++nodes > 60000 || stack.length > 160)
          throw Error("gallery_too_complex");
        const parent = stack.at(-1),
          label = `${a.id || ""} ${a.class || ""}`;
        const blocked =
          !!parent?.blocked ||
          [
            "script",
            "style",
            "nav",
            "aside",
            "footer",
            "header",
            "iframe",
          ].includes(tag) ||
          /(?:^|[-_\s])(?:ad|ads|adunit|advertisement|banner|logo|social)(?:$|[-_\s])|recommend|related|ranking|pagenation|pagination/i.test(
            label,
          ) ||
          a.hidden !== undefined ||
          a["aria-hidden"] === "true";
        const content =
          !!parent?.content ||
          ["article", "main", "figure"].includes(tag) ||
          /(?:entry|article|post)[-_](?:content|body)|(?:photo|image|gallery)[-_](?:main|body|content)|(?:^|\s)gallery(?:\s|$)/i.test(
            label,
          ) ||
          a.itemprop === "articleBody";
        stack.push({ blocked, content });
        if (tag === "title") inTitle = true;
        if (
          tag === "meta" &&
          ["og:image", "twitter:image"].includes(a.property || a.name)
        )
          add(a.content || "", "", fallback);
        if (blocked || !content || tag !== "img") return;
        if (
          (a.width && Number(a.width) < 80) ||
          (a.height && Number(a.height) < 80)
        )
          return;
        const candidates = [
          ...(a["data-srcset"] || a.srcset || "").matchAll(
            /(\S+)\s+(\d+(?:\.\d+)?)[wx](?:,|$)/g,
          ),
        ].sort((x, y) => Number(y[2]) - Number(x[2]));
        const src =
          candidates.find((m) => publicPhotoUrl(m[1], pageUrl))?.[1] ||
          a["data-src"] ||
          a["data-original"] ||
          a.src;
        if (src) add(src, a.alt || "");
      },
      ontext(text) {
        if (inTitle) title += text;
      },
      onclosetag(tag) {
        stack.pop();
        if (tag === "title") inTitle = false;
      },
    },
    { decodeEntities: true },
  ).end(html);
  if (!pictures.length) pictures.push(...fallback.slice(0, 1));
  if (!pictures.length) throw Error("gallery_structure_changed");
  const pages = pictures.map((_, i) =>
    i ? `${pageUrl}#romnoa-photo-${i + 1}` : pageUrl,
  );
  return {
    kind: "gallery" as const,
    picture: pictures[0],
    pictures,
    pages,
    thumbnails: pictures.map((p, i) => ({ pageUrl: pages[i], url: p.url })),
    title: title.trim().slice(0, 500),
  };
}
