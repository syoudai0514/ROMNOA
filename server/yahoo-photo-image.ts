import { fetchPublicPhoto } from "./public-photo-fetch.js";
import { yahooArticleUrl } from "../src/lib/yahoo-model.js";
import {
  photoFeatureTarget,
  linkedPhotoTarget,
  linkedImageUrl,
  mantanPhotoUrl,
  originalPhotoCandidate,
} from "../src/lib/yahoo-photos-model.js";
import { imageDimensions } from "./image-dimensions.js";
import {
  yahooPhotoService,
  PhotoAccessError,
  type YahooPhotoService,
} from "./yahoo-photos.js";

const LIMIT = 2_000_000;
type ImageData = { body: Uint8Array; type: string };
// An original may be larger than a rendition, but must still fit in one
// function response.
const ORIGINAL_LIMIT = 4_000_000;
export async function fetchPhotoImage(
  source: { url: string; referer: string },
  fetcher: typeof fetch = fetchPublicPhoto,
  limit = LIMIT,
): Promise<ImageData> {
  const target = linkedPhotoTarget(source.referer);
  if (
    !target ||
    !(photoFeatureTarget(source.referer)
      ? mantanPhotoUrl(source.url, target.family)
      : linkedImageUrl(source.url))
  )
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
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
    ].includes(type)
  ) {
    await response.body?.cancel();
    throw Error("image_unavailable");
  }
  if (Number(response.headers.get("content-length")) > limit) {
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
      if (size > limit) throw Error("image_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return { body: Buffer.concat(chunks), type };
}
// The original is not offered for this photo, or it was fetched and did not
// prove to be a larger copy of the same photograph. The shown image stays.
export class OriginalUnavailable extends Error {}
// A fetched original replaces a rendition only if it decodes as an image, is
// clearly larger than the rendition's declared size, and has the same shape
// (a crop such as -150x150 or a different picture would not).
export function confirmsOriginal(
  image: ImageData,
  declared: { width: number; height: number },
) {
  const size = imageDimensions(image.body);
  if (!size || !size.width || !size.height) return false;
  const larger =
    Math.max(size.width, size.height) >=
    1.25 * Math.max(declared.width, declared.height);
  const ratio = size.width / size.height,
    expected = declared.width / declared.height;
  return larger && Math.abs(ratio - expected) / expected <= 0.02;
}
export class PhotoImageService {
  private cache = new Map<string, ImageData & { at: number }>();
  private pending = new Map<string, Promise<ImageData>>();
  // Originals that failed confirmation, so they are not fetched again.
  private rejected = new Map<string, number>();
  private size = 0;
  constructor(
    private resolve: Pick<YahooPhotoService, "imageSource"> = yahooPhotoService,
    private load = fetchPhotoImage,
    private now = Date.now,
    private loadOriginal = (source: { url: string; referer: string }) =>
      fetchPhotoImage(source, fetchPublicPhoto, ORIGINAL_LIMIT),
  ) {}
  // Fetch and confirm the original of the page's shown photo. Called by the
  // client after the shown image is on screen, never on the article path.
  async original(article: string, feature: string, page: string) {
    const source = await this.resolve.imageSource(article, feature, page, false);
    const candidate = originalPhotoCandidate(source.url);
    if (!candidate || !linkedImageUrl(candidate.url))
      throw new OriginalUnavailable("no_original");
    const key = `original:${candidate.url}`;
    const at = this.rejected.get(candidate.url);
    if (at !== undefined && this.now() - at >= 0 && this.now() - at < 3600000)
      throw new OriginalUnavailable("original_rejected");
    return this.remember(key, async () => {
      let image: ImageData;
      try {
        image = await this.loadOriginal({ url: candidate.url, referer: source.referer });
      } catch {
        image = { body: new Uint8Array(), type: "" };
      }
      if (!image.body.byteLength || !confirmsOriginal(image, candidate)) {
        this.rejected.delete(candidate.url);
        this.rejected.set(candidate.url, this.now());
        if (this.rejected.size > 500)
          this.rejected.delete(this.rejected.keys().next().value!);
        throw new OriginalUnavailable("original_not_confirmed");
      }
      return image;
    });
  }
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
    return this.remember(source.url, () => this.load(source));
  }
  private async remember(key: string, fetch: () => Promise<ImageData>) {
    const cached = this.cache.get(key);
    if (
      cached &&
      this.now() - cached.at >= 0 &&
      this.now() - cached.at < 3600000
    )
      return cached;
    const active = this.pending.get(key);
    if (active) return active;
    const work = (async () => {
      const data = await fetch();
      const old = this.cache.get(key);
      if (old) {
        this.size -= old.body.byteLength;
        this.cache.delete(key);
      }
      this.cache.set(key, { ...data, at: this.now() });
      this.size += data.body.byteLength;
      while (this.cache.size > 32 || this.size > 24_000_000) {
        const oldest = this.cache.keys().next().value!;
        this.size -= this.cache.get(oldest)!.body.byteLength;
        this.cache.delete(oldest);
      }
      return data;
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
}
const service = new PhotoImageService();
export async function handleYahooPhotoImage(
  request: Request,
  engine = service,
  enabled = true,
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
    linkedPhotoTarget(feature)?.url !== feature ||
    linkedPhotoTarget(page)?.url !== page ||
    !["full", "thumb", "original"].includes(size) ||
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
  if (!enabled)
    return Response.json(
      { error: "この機能は現在利用できません。" },
      { status: 403, headers },
    );
  try {
    const image =
      size === "original"
        ? await engine.original(article, feature, page)
        : await engine.get(article, feature, page, size === "thumb");
    return new Response(new Uint8Array(image.body), {
      headers: {
        ...headers,
        "Cache-Control": "private, max-age=3600",
        "Content-Type": image.type,
        "Content-Length": String(image.body.byteLength),
      },
    });
  } catch (e) {
    if (e instanceof OriginalUnavailable)
      return Response.json(
        { error: "原寸の写真はありません。" },
        { status: 404, headers },
      );
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
