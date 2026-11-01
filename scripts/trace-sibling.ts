// Why a page is or is not a sibling-page gallery: npx tsx scripts/trace-sibling.ts URL
import { fetchPhotoHtml } from "../server/yahoo-photos.js";
import { siblingGallery } from "../server/sibling-gallery.js";
import { linkedPhotoTarget } from "../src/lib/yahoo-photos-model.js";
for (const raw of process.argv.slice(2)) {
  const url = linkedPhotoTarget(raw)?.url || raw;
  try {
    const r = siblingGallery(await fetchPhotoHtml(url), url, (reason, detail) =>
      console.log(reason, JSON.stringify(detail).slice(0, 700)),
    );
    console.log("=>", r ? `${r.pages.length} ${r.picture.url}` : null);
  } catch (e) {
    console.log("ERR", String(e));
  }
}
