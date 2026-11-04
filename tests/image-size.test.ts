import { describe, expect, it } from "vitest";
import { imageDimensions } from "../scripts/image-size";
describe("audit image size reader", () => {
  it("reads PNG, GIF and JPEG headers", () => {
    const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47]); new DataView(png.buffer).setUint32(16, 1200); new DataView(png.buffer).setUint32(20, 800);
    expect(imageDimensions(png)).toEqual({ width: 1200, height: 800 });
    const gif = new Uint8Array(16); gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 64, 0, 48, 0]);
    expect(imageDimensions(gif)).toEqual({ width: 64, height: 48 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x03, 0x20, 0x04, 0xb0, 3, 0, 0, 0]);
    expect(imageDimensions(jpg)).toEqual({ width: 1200, height: 800 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("reads AVIF dimensions from the ispe box", () => {
    const b = new Uint8Array(64);
    b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    b.set([0x69, 0x73, 0x70, 0x65], 30);
    const v = new DataView(b.buffer);
    v.setUint32(38, 1600); v.setUint32(42, 900);
    expect(imageDimensions(b)).toEqual({ width: 1600, height: 900 });
  });
});
