import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { handleArticles } from "./server/handler";
import { handleReader } from "./server/reader";
import { handleDiscovery } from "./server/discovery";
import { handleSearch } from "./server/search";
import { handleYahoo } from "./server/yahoo";

const api = (): Plugin => ({
  name: "romnoa-api",
  configureServer(server) {
    for (const [path, handler] of [
      ["/api/articles", handleArticles],
      ["/api/reader", handleReader],
      ["/api/discovery", handleDiscovery],
      ["/api/search", handleSearch],
      ["/api/yahoo", handleYahoo],
    ] as const) {
      server.middlewares.use(path, async (req, res) => {
        try {
          const result = await handler(
            new Request(`http://localhost${path}${req.url ?? ""}`, {
              method: req.method,
              headers: Object.fromEntries(
                Object.entries(req.headers).flatMap(([key, value]) =>
                  value === undefined
                    ? []
                    : [[key, Array.isArray(value) ? value.join(",") : value]],
                ),
              ),
            }),
          );
          res.statusCode = result.status;
          result.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await result.text());
        } catch (error) {
          console.error(
            "ROMNOA development_api_failed",
            path,
            error instanceof Error ? error.name : "unknown",
            error instanceof Error
              ? error.stack?.split("\n").slice(1, 5).join("\n")
              : "",
          );
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "記事を取得できませんでした。" }));
        }
      });
    }
    server.middlewares.use("/api", (_req, res) => {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "APIが見つかりません。" }));
    });
  },
});

export default defineConfig({
  server: {
    watch: { awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } },
  },
  plugins: [
    react(),
    tailwindcss(),
    api(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "ロムノア — ROMNOA",
        short_name: "ロムノア",
        lang: "ja",
        description: "読みたい話題だけ、ノイズなく。",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f7f8f4",
        theme_color: "#f7f8f4",
        icons: [192, 512].map((size) => ({
          src: `/icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "any",
        })),
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
        // API data is validated and saved by the app, never cached as an HTML navigation.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
