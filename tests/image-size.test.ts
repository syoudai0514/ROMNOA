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
});
