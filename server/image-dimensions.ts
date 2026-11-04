// Read the pixel size of a JPEG / PNG / GIF / WebP / AVIF from its first
// bytes. Used to confirm a photo before it replaces another, and by audits.
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
