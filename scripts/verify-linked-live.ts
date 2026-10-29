import { YahooPhotoService, MemoryPhotoCache } from "../server/yahoo-photos.js";
import { fetchPhotoImage } from "../server/yahoo-photo-image.js";
const article =
  "https://news.yahoo.co.jp/articles/ddb6af1521c0d44e9d14001727af40a0fd82a6f8";
const service = new YahooPhotoService(new MemoryPhotoCache());
const meta = await service.get(article);
if (meta.kind !== "article") throw Error("metadata");
const feature = meta.features[0].url;
const gallery = await service.get(article, feature);
if (gallery.kind !== "gallery") throw Error("gallery");
for (const page of gallery.pages) {
  const image = await fetchPhotoImage(
    await service.imageSource(article, feature, page, false),
  );
  console.log(page, image.type, image.body.byteLength);
}
