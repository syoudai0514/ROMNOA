import { parseDocument, DomUtils } from "htmlparser2";
import type { Element, AnyNode } from "domhandler";
import { socialPostUrl } from "../src/lib/reader-media.js";
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
// Publishers often place a transparent protection or loading layer over the
// actual photograph. These are UI assets, not gallery pictures.
function imageOverlay(node: Element, url: string) {
  const label = `${node.attribs.class || ""} ${node.attribs.id || ""}`;
  const filename = new URL(url).pathname.split("/").pop() || "";
  return (
    /(?:image[-_]?protect|photo[-_]?protect|placeholder|spacer|loading[-_]?image)/i.test(
      label,
    ) ||
    /^(?:img|image|photo)[-_]protect\.|^(?:placeholder|spacer|transparent|loading)\.(?:png|gif|webp|avif)$/i.test(
      filename,
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
    a.itemprop === "articleBody" ||
    a.id === "entry"
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
  // Some galleries use one .html document per image and a thumbnail roster.
  // The publisher's image IDs are not necessarily sequential; keep the roster
  // order and require the current page, full image and thumbnail IDs to agree.
  const basePage = new URL(pageUrl);
  const numberedHtml = basePage.pathname.match(/^(.*\/)(\d+)\.html$/);
  if (numberedHtml && !basePage.search && !basePage.hash) {
    const mains = DomUtils.findAll(
      (n) => n.name === "main" && !blocked(n),
      doc.children,
    );
    for (const main of mains) {
      const lists = DomUtils.findAll(
        (n) =>
          n.name === "ul" &&
          /(?:^|[-_\s])thumb(?:nail)?[-_\s]/i.test(n.attribs.class || "") &&
          !blocked(n),
        main.children,
      );
      const figures = DomUtils.findAll(
        (n) => n.name === "figure" && !blocked(n),
        main.children,
      );
      const figure = figures.find((f) =>
        DomUtils.findOne((n) => {
          if (n.name !== "img" || blocked(n)) return false;
          const url = publicPhotoUrl(
            n.attribs["data-src"] || n.attribs.src || "",
            pageUrl,
          );
          return (
            !!url &&
            new URL(url).pathname.match(
              new RegExp(
                `/\\b${numberedHtml[2]}\\.(?:jpe?g|png|webp|avif)$`,
                "i",
              ),
            ) !== null
          );
        }, f.children),
      );
      if (!figure) continue;
      const full = DomUtils.findOne((n) => {
        if (n.name !== "img" || blocked(n)) return false;
        const url = publicPhotoUrl(
          n.attribs["data-src"] || n.attribs.src || "",
          pageUrl,
        );
        return (
          !!url &&
          new URL(url).pathname
            .split("/")
            .pop()
            ?.match(
              new RegExp(`^${numberedHtml[2]}\\.(?:jpe?g|png|webp|avif)$`, "i"),
            ) != null
        );
      }, figure.children);
      const fullUrl =
        full &&
        publicPhotoUrl(
          full.attribs["data-src"] || full.attribs.src || "",
          pageUrl,
        );
      if (!full || !fullUrl || imageOverlay(full, fullUrl)) continue;
      for (const list of lists) {
        const entries = DomUtils.findAll(
          (n) => n.name === "a",
          list.children,
        ).flatMap((anchor) => {
          const link = publicPhotoUrl(anchor.attribs.href || "", pageUrl);
          const image = DomUtils.findOne(
            (n) => n.name === "img",
            anchor.children,
          );
          const thumb =
            image &&
            publicPhotoUrl(
              image.attribs["data-src"] || image.attribs.src || "",
              pageUrl,
            );
          if (!link || !thumb || !image) return [];
          const target = new URL(link);
          const match = target.pathname.match(/^(.*\/)(\d+)\.html$/);
          if (
            !match ||
            target.origin !== basePage.origin ||
            match[1] !== numberedHtml[1] ||
            target.search ||
            target.hash ||
            !new RegExp(`^${match[2]}\\.(?:jpe?g|png|webp|avif)$`, "i").test(
              new URL(thumb).pathname.split("/").pop() || "",
            ) ||
            imageOverlay(image, thumb)
          )
            return [];
          return [{ pageUrl: target.href, url: thumb }];
        });
        if (
          entries.length < 2 ||
          entries.length > 40 ||
          !entries.some((e) => e.pageUrl === pageUrl) ||
          new Set(entries.map((e) => e.pageUrl)).size !== entries.length
        )
          continue;
        const alt = (full.attribs.alt || "").trim().slice(0, 500);
        const captionNode = DomUtils.findOne(
          (n) => n.name === "figcaption",
          figure.children,
        );
        const caption = captionNode
          ? DomUtils.textContent(captionNode)
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 500)
          : alt;
        return {
          kind: "gallery" as const,
          picture: { url: fullUrl, alt, caption },
          pages: entries.map((e) => e.pageUrl),
          thumbnails: entries,
          pictures: [] as YahooPicture[],
          title,
          linkedPages: [] as string[],
          hasPrimaryPhoto: true,
        };
      }
    }
  }
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
          !(
            new URL(href).origin === new URL(pageUrl).origin &&
            new URL(pageUrl).pathname.split("/").filter(Boolean).length >= 3 &&
            new URL(pageUrl).pathname.replace(/\/\d+\/?$/, "/") !==
              new URL(pageUrl).pathname &&
            new URL(href).pathname.startsWith(
              new URL(pageUrl).pathname.replace(/\/\d+\/?$/, "/"),
            )
          ) &&
          !(
            new URL(href).origin === new URL(pageUrl).origin &&
            new URL(href).searchParams.get("article_id") ===
              new URL(pageUrl).pathname.match(/\/(\d+)\/?$/)?.[1]
          ) &&
          !/\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(href)
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
          !imageOverlay(node, url) &&
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
  // Some publishers expose explicit photo-page links next to thumbnail images.
  // Validate the common article path and photo identity, then load each page's
  // declared full-size image on demand instead of enlarging its thumbnail.
  const origin = new URL(pageUrl);
  const matchPage = origin.pathname.match(/^(.*\/)(\d+)\/$/);
  if (matchPage && fallback.length) {
    const lists = DomUtils.findAll(
      (n) => n.name === "ul" && /thumb/i.test(n.attribs.class || ""),
      doc.children,
    );
    for (const list of lists) {
      const entries = DomUtils.findAll(
        (n) => n.name === "li",
        list.children,
      ).flatMap((li) => {
        const anchor = DomUtils.findOne((n) => n.name === "a", li.children);
        const image = DomUtils.findOne((n) => n.name === "img", li.children);
        const link =
          anchor && publicPhotoUrl(anchor.attribs.href || "", pageUrl);
        const thumb =
          image &&
          publicPhotoUrl(
            image.attribs.src || image.attribs["data-src"] || "",
            pageUrl,
          );
        if (!link || !thumb) return [];
        const u = new URL(link),
          src = new URL(thumb);
        const m = u.pathname.match(/^(.*\/)(\d+)\/$/);
        if (
          !m ||
          u.origin !== origin.origin ||
          m[1] !== matchPage[1] ||
          u.search ||
          u.hash ||
          !src.pathname.endsWith(`/${m[2]}.jpg`)
        )
          return [];
        return [{ pageUrl: u.href, url: thumb, alt: image?.attribs.alt || "" }];
      });
      const current = entries.find((e) => e.pageUrl === pageUrl);
      const full = new URL(fallback[0].url);
      if (
        entries.length < 2 ||
        entries.length > 40 ||
        !current ||
        new Set(entries.map((e) => e.pageUrl)).size !== entries.length ||
        full.origin !== new URL(current.url).origin ||
        full.pathname !== new URL(current.url).pathname
      )
        continue;
      return {
        kind: "gallery" as const,
        picture: {
          url: full.href,
          alt: current.alt.slice(0, 500),
          caption: current.alt.slice(0, 500),
        },
        pages: entries.map((e) => e.pageUrl),
        thumbnails: entries.map(({ pageUrl, url }) => ({ pageUrl, url })),
        pictures: [] as YahooPicture[],
        title,
        linkedPages: [] as string[],
        hasPrimaryPhoto: true,
      };
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
  const remaining = DomUtils.findOne(
    (n) => (n.attribs.class || "").split(/\s+/).includes("js-gallery-more"),
    doc.children,
  );
  const declaredTotal = Number(remaining?.attribs["data-max"] || 0);
  if (Number.isInteger(declaredTotal) && declaredTotal > pictures.length)
    throw Error("incomplete_gallery");
  const posts = selected
    ? DomUtils.findAll((n) => n.name === "blockquote", selected.children)
        .flatMap((node) => {
          let parent: AnyNode | null = node;
          while (parent && parent !== selected) {
            if ("attribs" in parent && blocked(parent)) return [];
            parent = parent.parent;
          }
          const explicit = node.attribs["data-instgrm-permalink"];
          const candidates = explicit
            ? [explicit]
            : (node.attribs.class || "").split(/\s+/).includes("twitter-tweet")
              ? DomUtils.findAll((n) => n.name === "a", node.children).map(
                  (a) => a.attribs.href || "",
                )
              : [];
          const urls = candidates
            .map((raw) => socialPostUrl(raw))
            .filter(
              (p): p is NonNullable<ReturnType<typeof socialPostUrl>> => !!p,
            );
          return urls.length ? [urls[urls.length - 1]] : [];
        })
        .filter(
          (post, i, all) => all.findIndex((p) => p.url === post.url) === i,
        )
        .slice(0, 12)
    : [];
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
    posts,
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
