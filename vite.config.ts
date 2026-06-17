/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { serveEmbeds } from "./vite-plugins";

export default defineConfig({
  plugins: [react(), serveEmbeds()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    // TS sources take priority so a stray transpiled .js can't shadow
    // its .tsx original during dev.
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  build: {
    rollupOptions: {
      input: {
        // The full React shell at /index.html (src/app/main.tsx).
        index: path.resolve(__dirname, "index.html"),
        // The chrome-less bare host at /bare.html (src/app/bare.tsx) — just
        // SubstrateHost, URL-selected.
        bare: path.resolve(__dirname, "bare.html"),
      },
    },
  },
  test: {
    // .mjs tests cover the dev-only new-substrate tooling (untyped scripts
    // tsc ignores); .ts tests cover the engine.
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    environment: "node",
  },
});
