// Read the pixel size of a JPEG / PNG / GIF / WebP from its first bytes, for
// audits that must check photos are photographs rather than thumbnails.
import { fetchPublicPhoto } from "../server/public-photo-fetch.js";
import { imageDimensions } from "../server/image-dimensions.js";
export { imageDimensions };

// Fetch an image the way the app's image proxy does (with the page as
// referer) and return its pixel size; null when it cannot be read.
export async function fetchImageSize(url: string, referer: string) {
  try {
    const res = await fetchPublicPhoto(url, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "image/*", Referer: referer, "User-Agent": "ROMNOA/0.1 (+https://github.com/syoudai0514/ROMNOA)" },
    });
    if (!res.ok || !res.body) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return imageDimensions(buf);
  } catch {
    return null;
  }
}
// The audits call a photo "small" below this many pixels on its longer side.
export const SMALL_PHOTO_PX = 400;
// How many of a gallery's photos the audits measure.
export const MEASURED_PHOTOS = 12;

export type PhotoSizes = { measured: number; small: number; unknown: number; current: string };
// Measure the shown photo and up to MEASURED_PHOTOS of the gallery's photos.
// A photo that cannot be measured is "unknown", never "not small".
export async function measurePhotos(
  current: string,
  pictures: { url: string }[],
  referer: string,
): Promise<PhotoSizes> {
  const urls = [current, ...pictures.map((p) => p.url).filter((u) => u !== current)].slice(0, MEASURED_PHOTOS);
  const sizes = await Promise.all(urls.map((u) => fetchImageSize(u, referer)));
  const label = (s: (typeof sizes)[number]) =>
    s ? `${s.width}x${s.height}${Math.max(s.width, s.height) < SMALL_PHOTO_PX ? " SMALL" : ""}` : "?px";
  return {
    measured: sizes.filter(Boolean).length,
    small: sizes.filter((s) => s && Math.max(s.width, s.height) < SMALL_PHOTO_PX).length,
    unknown: sizes.filter((s) => !s).length,
    current: label(sizes[0]),
  };
}
