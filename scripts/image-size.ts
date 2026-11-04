// Read the pixel size of a JPEG / PNG / GIF / WebP from its first bytes, for
// audits that must check photos are photographs rather than thumbnails.
import { fetchPublicPhoto } from "../server/public-photo-fetch.js";

export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50)
    return { width: v.getUint32(16), height: v.getUint32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49)
    return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
  if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === "VP8 ") return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") {
      const n = v.getUint32(21, true);
      return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  // AVIF / HEIF: the "ispe" property box holds the image's width and height.
  if (b.length > 12 && String.fromCharCode(b[4], b[5], b[6], b[7]) === "ftyp") {
    for (let i = 8; i + 16 < b.length; i++)
      if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65)
        return { width: v.getUint32(i + 8), height: v.getUint32(i + 12) };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1], length = v.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
      i += 2 + length;
    }
  }
  return null;
}

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
