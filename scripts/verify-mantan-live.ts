import sharp from "sharp";
import {
  fetchPhotoHtml,
  parseMantanPhotoPage,
} from "../server/yahoo-photos.js";
import { fetchPhotoImage } from "../server/yahoo-photo-image.js";
const target =
  process.argv[2] ||
  "https://gravure.mantan-web.jp/article/20251206dog00m200056000c/photopage/001.html";
const gallery = parseMantanPhotoPage(await fetchPhotoHtml(target), target);
console.log(
  `Gallery: ${gallery.pages.length} pages, ${gallery.thumbnails.length} thumbnails`,
);
const queue = [...gallery.pages];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const page = queue.shift()!;
      const selected =
        page === target
          ? gallery
          : parseMantanPhotoPage(await fetchPhotoHtml(page), page);
      const image = await fetchPhotoImage({
        url: selected.picture.url,
        referer: page,
      });
      const { width, height } = await sharp(image.body).metadata();
      if (!width || !height) throw Error("invalid image");
      console.log(
        `${page.split("/").pop()}: ${width}x${height}, ${image.body.byteLength} bytes`,
      );
    }
  }),
);
for (const thumbnail of [gallery.thumbnails[0], gallery.thumbnails.at(-1)!]) {
  const image = await fetchPhotoImage({ url: thumbnail.url, referer: target });
  const { width, height } = await sharp(image.body).metadata();
  console.log(`Thumbnail: ${width}x${height}, ${image.body.byteLength} bytes`);
}
