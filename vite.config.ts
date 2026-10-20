import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { handleArticles } from "./server/handler";

const api = (): Plugin => ({
  name: "romnoa-api",
  configureServer(server) {
    server.middlewares.use("/api/articles", async (req, res) => {
      try {
        const result = await handleArticles(
          new Request(`http://localhost/api/articles${req.url ?? ""}`, {
            method: req.method,
          }),
        );
        res.statusCode = result.status;
        result.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await result.text());
      } catch {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "記事を取得できませんでした。" }));
      }
    });
  },
});

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    api(),
    VitePWA({
      registerType: "prompt",
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
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
        // API data is validated and saved by the app, never cached as an HTML navigation.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
