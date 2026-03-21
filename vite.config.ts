import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG || "ezdrive",
            project: process.env.SENTRY_PROJECT || "supervision",
            authToken: process.env.SENTRY_AUTH_TOKEN,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // ── Vendor chunks (loaded in parallel by browser) ──
          "vendor-react": [
            "react",
            "react-dom",
            "react-router-dom",
          ],
          "vendor-query": [
            "@tanstack/react-query",
          ],
          "vendor-supabase": [
            "@supabase/supabase-js",
          ],
          "vendor-charts": [
            "recharts",
          ],
          "vendor-map": [
            "leaflet",
            "react-leaflet",
          ],
          "vendor-icons": [
            "lucide-react",
          ],
        },
      },
    },
  },
});
