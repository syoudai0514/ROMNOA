import { yahooArticleUrl } from "../src/lib/yahoo-model.js";
import {
  photoFeatureTarget,
  mantanPhotoUrl,
} from "../src/lib/yahoo-photos-model.js";
import {
  yahooPhotoService,
  PhotoAccessError,
  type YahooPhotoService,
} from "./yahoo-photos.js";

const LIMIT = 2_000_000;
type ImageData = { body: Uint8Array; type: string };
export async function fetchPhotoImage(
  source: { url: string; referer: string },
  fetcher: typeof fetch = fetch,
): Promise<ImageData> {
  const target = photoFeatureTarget(source.referer);
  if (!target || !mantanPhotoUrl(source.url, target.family))
    throw new PhotoAccessError("image_not_allowed");
  // Preserve the context of the document that declared this exact image. The
  // client cannot supply an upstream URL or a Referer header.
  const response = await fetcher(source.url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: "image/webp,image/jpeg,image/png,image/*;q=0.8",
      Referer: target.url,
      "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)",
    },
  });
  const type =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ||
    "";
  if (
    !response.ok ||
    !response.body ||
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)
  ) {
    await response.body?.cancel();
    throw Error("image_unavailable");
  }
  if (Number(response.headers.get("content-length")) > LIMIT) {
    await response.body.cancel();
    throw Error("image_too_large");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMIT) throw Error("image_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return { body: Buffer.concat(chunks), type };
}
export class PhotoImageService {
  private cache = new Map<string, ImageData & { at: number }>();
  private pending = new Map<string, Promise<ImageData>>();
  private size = 0;
  constructor(
    private resolve: Pick<YahooPhotoService, "imageSource"> = yahooPhotoService,
    private load = fetchPhotoImage,
    private now = Date.now,
  ) {}
  async get(
    article: string,
    feature: string,
    page: string,
    thumbnail: boolean,
  ) {
    const source = await this.resolve.imageSource(
      article,
      feature,
      page,
      thumbnail,
    );
    const cached = this.cache.get(source.url);
    if (
      cached &&
      this.now() - cached.at >= 0 &&
      this.now() - cached.at < 3600000
    )
      return cached;
    const active = this.pending.get(source.url);
    if (active) return active;
    const work = (async () => {
      const data = await this.load(source);
      const old = this.cache.get(source.url);
      if (old) {
        this.size -= old.body.byteLength;
        this.cache.delete(source.url);
      }
      this.cache.set(source.url, { ...data, at: this.now() });
      this.size += data.body.byteLength;
      while (this.cache.size > 32 || this.size > 16_000_000) {
        const key = this.cache.keys().next().value!;
        this.size -= this.cache.get(key)!.body.byteLength;
        this.cache.delete(key);
      }
      return data;
    })();
    this.pending.set(source.url, work);
    try {
      return await work;
    } finally {
      this.pending.delete(source.url);
    }
  }
}
const service = new PhotoImageService();
export async function handleYahooPhotoImage(
  request: Request,
  engine = service,
  preview = !process.env.VERCEL || process.env.VERCEL_ENV === "preview",
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (request.method !== "GET")
    return Response.json(
      { error: "GETを使用してください。" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  const p = new URL(request.url).searchParams,
    article = p.get("article") || "",
    feature = p.get("feature") || "",
    page = p.get("page") || "",
    size = p.get("size") || "full";
  if (
    yahooArticleUrl(article) !== article ||
    photoFeatureTarget(feature)?.url !== feature ||
    photoFeatureTarget(page)?.url !== page ||
    !["full", "thumb"].includes(size) ||
    [...p.keys()].some(
      (k) =>
        !["article", "feature", "page", "size"].includes(k) ||
        p.getAll(k).length !== 1,
    )
  )
    return Response.json(
      { error: "対応していない写真です。" },
      { status: 400, headers },
    );
  if (!preview)
    return Response.json(
      { error: "個人用プレビュー専用です。" },
      { status: 403, headers },
    );
  try {
    const image = await engine.get(article, feature, page, size === "thumb");
    return new Response(new Uint8Array(image.body), {
      headers: {
        ...headers,
        "Cache-Control": "private, max-age=3600",
        "Content-Type": image.type,
        "Content-Length": String(image.body.byteLength),
      },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof PhotoAccessError
            ? "この記事に紐づく写真ではありません。"
            : "写真を読み込めませんでした。",
      },
      { status: e instanceof PhotoAccessError ? 403 : 502, headers },
    );
  }
}
