import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

// Vite/Vitest resolve extensionless TypeScript imports that native Node ESM cannot.
// Compile and import the same server module graph that Vercel executes.
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"],
  { stdio: "inherit" },
);
const output = new URL(
  "../node_modules/.cache/romnoa-server/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
await writeFile(new URL("package.json", output), '{"type":"module"}\n');
const { GET } = await import(new URL("api/articles.js", output));
const response = await GET(
  new Request("http://localhost/api/articles?url=http://127.0.0.1/"),
);
if (response.status !== 400)
  throw new Error(`Native server smoke failed: ${response.status}`);
const { GET: read } = await import(new URL("api/reader.js", output));
const { GET: discover } = await import(new URL("api/discovery.js", output));
const { GET: search } = await import(new URL("api/search.js", output));
if (
  (await search(new Request("http://localhost/api/search?q=x&page=0")))
    .status !== 400
)
  throw new Error("Native search query rejection failed");
const { GET: yahoo } = await import(new URL("api/yahoo.js", output));
if (
  (await yahoo(new Request("http://localhost/api/yahoo?url=http://127.0.0.1/")))
    .status !== 400
)
  throw new Error("Native Yahoo query rejection failed");
const { GET: yahooSearch } = await import(
  new URL("api/yahoo-search.js", output)
);
if (
  (
    await yahooSearch(
      new Request(
        "http://localhost/api/yahoo-search?q=x&url=http://127.0.0.1/",
      ),
    )
  ).status !== 400
)
  throw new Error("Native Yahoo search query rejection failed");
const { GET: yahooPhotos } = await import(
  new URL("api/yahoo-photos.js", output)
);
if (
  (
    await yahooPhotos(
      new Request(
        "http://localhost/api/yahoo-photos?article=http://127.0.0.1/",
      ),
    )
  ).status !== 400
)
  throw new Error("Native Yahoo photo target rejection failed");
const { GET: photoImage } = await import(
  new URL("api/yahoo-photo-image.js", output)
);
if (
  (
    await photoImage(
      new Request(
        "http://localhost/api/yahoo-photo-image?url=http://127.0.0.1/",
      ),
    )
  ).status !== 400
)
  throw new Error("Native photo image rejection failed");
const { GET: social } = await import(new URL("api/social.js", output));
if (
  (
    await social(
      new Request("http://localhost/api/social?url=http://127.0.0.1/"),
    )
  ).status !== 400
)
  throw new Error("Native social post rejection failed");
const invalidDiscovery = await discover(
  new Request("http://localhost/api/discovery?mode=date&date=2026-02-30"),
);
if (invalidDiscovery.status !== 400)
  throw new Error(`Native discovery smoke failed: ${invalidDiscovery.status}`);
const readerResponse = await read(
  new Request("http://localhost/api/reader?article=http://127.0.0.1/"),
);
if (![400, 403].includes(readerResponse.status))
  throw new Error(`Native reader smoke failed: ${readerResponse.status}`);
console.log(
  "Native Node ESM API import + query rejection PASS (no upstream requests).",
);
