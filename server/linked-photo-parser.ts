import { parseDocument, DomUtils } from "htmlparser2";
import type { Element, AnyNode } from "domhandler";
import { publicPhotoUrl } from "../src/lib/public-photo-url.js";
import type { YahooPicture } from "../src/lib/yahoo-photos-model.js";

const blockedTags = new Set([
  "script",
  "style",
  "nav",
  "aside",
  "footer",
  "header",
  "iframe",
]);
function blocked(node: Element) {
  const a = node.attribs;
  return (
    blockedTags.has(node.name) ||
    a.hidden !== undefined ||
    a["aria-hidden"] === "true" ||
    /(?:^|[-_\s])(?:ad|ads|adunit|advertisement|banner|logo|social)(?:$|[-_\s])|recommend|related|ranking|pagenation|pagination/i.test(
      `${a.id || ""} ${a.class || ""}`,
    )
  );
}
function priority(node: Element) {
  const a = node.attribs,
    label = `${a.id || ""} ${a.class || ""}`;
  if (
    /(?:photo|image|gallery)[-_](?:main|body|content)|(?:content)[-_]image[-_]main|(?:^|\s)gallery(?:\s|$)/i.test(
      label,
    )
  )
    return 5;
  if (node.name === "figure") return 4;
  if (
    /(?:entry|article|post)[-_](?:content|body)/i.test(label) ||
    a.itemprop === "articleBody"
  )
    return 3;
  if (node.name === "article") return 2;
  return node.name === "main" ? 1 : 0;
}
function numberedPage(raw: string, base: string) {
  const url = publicPhotoUrl(raw, base);
  if (!url) return null;
  const a = new URL(base),
    b = new URL(url);
  const pattern = /^(.*\/)\d+$/;
  if (
    !pattern.test(a.pathname) ||
    a.origin !== b.origin ||
    a.search !== b.search ||
    b.hash ||
    a.pathname.replace(pattern, "$1") !== b.pathname.replace(pattern, "$1") ||
    !pattern.test(b.pathname)
  )
    return null;
  return b.href;
}

// Pick a single primary content region. Broad main/article ancestry is not
// evidence that every descendant image belongs to the gallery.
export function parseLinkedPhotos(html: string, pageUrl: string) {
  if (Buffer.byteLength(html) > 2_000_000) throw Error("page_too_large");
  const doc = parseDocument(html, { decodeEntities: true });
  const regions: { node: Element; rank: number }[] = [];
  const fallback: YahooPicture[] = [];
  const headPages = new Set<string>();
  let title = "",
    count = 0;
  function scan(nodes: AnyNode[], depth = 0) {
    if (depth > 160) throw Error("gallery_too_complex");
    for (const node of nodes) {
      if (++count > 60000) throw Error("gallery_too_complex");
      if (!("attribs" in node)) continue;
      const a = node.attribs;
      if (node.name === "title")
        title = DomUtils.textContent(node).trim().slice(0, 500);
      if (
        node.name === "meta" &&
        ["og:image", "twitter:image"].includes(a.property || a.name)
      ) {
        const url = publicPhotoUrl(a.content || "", pageUrl);
        if (url) fallback.push({ url, alt: "" });
      }
      if (node.name === "link" && /^(prev|next)$/.test(a.rel || "")) {
        const page = numberedPage(a.href || "", pageUrl);
        if (page) headPages.add(page);
      }
      if (blocked(node)) continue;
      const rank = priority(node);
      if (rank) regions.push({ node, rank });
      scan(node.children, depth + 1);
    }
  }
  scan(doc.children);
  const primary =
    regions.find((r) => r.node.name === "article" || r.rank === 3) ||
    regions.find((r) => r.node.name === "main");
  const inside = (node: AnyNode, ancestor: AnyNode): boolean =>
    node === ancestor || (!!node.parent && inside(node.parent, ancestor));
  const scoped = primary
    ? regions.filter((r) => {
        if (!inside(r.node, primary.node)) return false;
        for (
          let node: AnyNode | null = r.node;
          node && node !== primary.node;
          node = node.parent
        )
          if ("name" in node && node.name === "article") return false;
        return true;
      })
    : regions;
  scoped.sort((a, b) => b.rank - a.rank);
  let pictures: YahooPicture[] = [],
    selected: Element | undefined;
  function extract(root: Element) {
    const result: YahooPicture[] = [];
    function visit(node: AnyNode) {
      if (!("attribs" in node) || blocked(node)) return;
      if (node !== root && node.name === "article") return;
      const a = node.attribs;
      // Linked cards for other documents are not article photos.
      if (node.name === "a" && a.href) {
        const href = publicPhotoUrl(a.href, pageUrl);
        if (
          href &&
          href.split("#")[0] !== pageUrl &&
          !/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(href)
        )
          return;
      }
      if (node.name === "img") {
        if (
          (a.width && Number.parseInt(a.width) < 80) ||
          (a.height && Number.parseInt(a.height) < 80)
        )
          return;
        const choices = [
          ...(a["data-srcset"] || a.srcset || "").matchAll(
            /(\S+)\s+(\d+(?:\.\d+)?)[wx](?:,|$)/g,
          ),
        ].sort((x, y) => Number(y[2]) - Number(x[2]));
        const raw =
          choices.find((m) => publicPhotoUrl(m[1], pageUrl))?.[1] ||
          a["data-src"] ||
          a["data-original"] ||
          a.src;
        const url = raw && publicPhotoUrl(raw, pageUrl);
        if (
          url &&
          !/\.(?:svg|ico)(?:[?#]|$)/i.test(url) &&
          result.length < 40 &&
          !result.some((p) => p.url === url)
        ) {
          const alt = (a.alt || "").trim().slice(0, 500);
          result.push({ url, alt, caption: alt });
        }
      }
      for (const child of node.children) visit(child);
    }
    visit(root);
    return result;
  }
  for (const region of scoped) {
    const found = extract(region.node);
    if (found.length) {
      pictures = found;
      selected = region.node;
      break;
    }
  }
  if (!pictures.length) pictures = fallback.slice(0, 1);
  if (!pictures.length) throw Error("gallery_structure_changed");
  const linkedPages = new Set<string>();
  if (selected && pictures.length === 1) {
    for (const page of headPages) linkedPages.add(page);
    for (const a of DomUtils.findAll(
      (n) => n.name === "a",
      selected.children,
    )) {
      const page = numberedPage(a.attribs.href || "", pageUrl);
      if (page) linkedPages.add(page);
    }
  }
  // A declared thumbnail roster can describe many photos on one document.
  // Match it against the article's structured image list; ignore every other
  // linked image, recommendation and publisher logo.
  const base = new URL(pageUrl);
  const lists = DomUtils.findAll(
    (n) =>
      (n.name === "ul" || n.name === "div") &&
      /thumb/i.test(n.attribs.class || ""),
    doc.children,
  );
  const scripts = DomUtils.findAll(
    (n) => n.name === "script" && n.attribs.type === "application/ld+json",
    doc.children,
  );
  for (const list of lists) {
    const roster = DomUtils.findAll((n) => n.name === "a", list.children)
      .map((a) => {
        const link = publicPhotoUrl(a.attribs.href || "", pageUrl);
        const img = DomUtils.findOne((n) => n.name === "img", a.children);
        const src =
          img &&
          publicPhotoUrl(
            img.attribs.src || img.attribs["data-src"] || "",
            pageUrl,
          );
        if (!link || !src) return null;
        const u = new URL(link);
        if (
          u.origin !== base.origin ||
          u.pathname !== base.pathname ||
          !u.searchParams.get("p")
        )
          return null;
        return {
          id: u.searchParams.get("p"),
          src,
          alt: img?.attribs.alt || "",
        };
      })
      .filter(
        (v): v is { id: string; src: string; alt: string } =>
          !!v?.id && !!v.src,
      );
    if (
      roster.length < 2 ||
      roster.length > 40 ||
      new Set(roster.map((r) => r.id)).size !== roster.length
    )
      continue;
    for (const script of scripts) {
      let data: any;
      try {
        data = JSON.parse(DomUtils.textContent(script));
      } catch {
        continue;
      }
      if (
        !data ||
        !["NewsArticle", "Article"].includes(data["@type"]) ||
        !Array.isArray(data.image)
      )
        continue;
      const images = data.image
        .map((item: any) =>
          publicPhotoUrl(
            typeof item === "string" ? item : item?.url || "",
            pageUrl,
          ),
        )
        .filter(Boolean) as string[];
      const stem = (url: string) =>
        new URL(url).pathname.replace(/_\d+px(?=\.[a-z]+$)/i, "");
      const matches = roster.map((r) =>
        images.find(
          (url) =>
            new URL(url).origin === new URL(r.src).origin &&
            stem(url) === stem(r.src),
        ),
      );
      const current = roster.findIndex(
        (r) => r.id === base.searchParams.get("p"),
      );
      if (
        current < 0 ||
        matches.some((url) => !url) ||
        new Set(matches).size !== roster.length
      )
        continue;
      const ordered = matches.map((url, i) => ({
        url: url!,
        alt: roster[i].alt.slice(0, 500),
        caption: roster[i].alt.slice(0, 500),
      }));
      const rosterPages = ordered.map((_, i) =>
        i === current
          ? pageUrl
          : `${pageUrl}#romnoa-photo-${i < current ? i + 2 : i + 1}`,
      );
      return {
        kind: "gallery" as const,
        picture: ordered[current],
        pictures: ordered,
        pages: rosterPages,
        thumbnails: roster.map((r, i) => ({
          pageUrl: rosterPages[i],
          url: r.src,
        })),
        title,
        linkedPages: [] as string[],
        hasPrimaryPhoto: true,
      };
    }
  }
  const pages = pictures.map((_, i) =>
    i ? `${pageUrl}#romnoa-photo-${i + 1}` : pageUrl,
  );
  return {
    kind: "gallery" as const,
    picture: pictures[0],
    pictures,
    pages,
    thumbnails: pictures.map((p, i) => ({ pageUrl: pages[i], url: p.url })),
    title,
    linkedPages: [...linkedPages],
    hasPrimaryPhoto: !!selected,
  };
}

// Only follow explicit sibling pages in the same numbered gallery. Never infer
// URLs from a count, or follow adjacent news / recommended article links.
export async function collectLinkedPhotos(
  html: string,
  pageUrl: string,
  load: (url: string) => Promise<string>,
) {
  const first = parseLinkedPhotos(html, pageUrl);
  if (!first.linkedPages.length) return first;
  const found = new Map([[pageUrl, first]]);
  let queue = first.linkedPages.filter((p) => p !== pageUrl);
  const started = Date.now();
  while (queue.length) {
    if (found.size + queue.length > 40 || Date.now() - started > 16000)
      throw Error("gallery_too_large");
    const batch = queue.splice(0, 3);
    const loaded = await Promise.all(
      batch.map(async (url) => ({
        url,
        data: parseLinkedPhotos(await load(url), url),
      })),
    );
    for (const { url, data } of loaded) {
      if (!data.hasPrimaryPhoto || data.pictures.length !== 1)
        throw Error("gallery_structure_changed");
      found.set(url, data);
    }
    queue = [
      ...new Set([...queue, ...loaded.flatMap((p) => p.data.linkedPages)]),
    ].filter((p) => !found.has(p));
  }
  const pages = [...found.keys()].sort(
    (a, b) => Number(a.split("/").pop()) - Number(b.split("/").pop()),
  );
  const pictures = pages.map((p) => found.get(p)!.picture);
  return {
    ...first,
    pages,
    pictures,
    thumbnails: pages.map((pageUrl, i) => ({ pageUrl, url: pictures[i].url })),
  };
}
