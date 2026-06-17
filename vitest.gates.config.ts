/// <reference types="vitest" />
import { defineConfig } from "vite";
import path from "node:path";

// Runs the substrate acceptance-gate ladders (tests/gates/*.gates.ts) — the
// pre-written teeth of the spec-only-substrate briefs. Kept OUT of the default
// suite (vite.config.ts includes only *.test.ts): a gate ladder references the
// *implemented* type surface, so against a fresh no-op scaffold it is red by
// design. Run with `npm run gates:<name>`.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  test: {
    include: ["tests/gates/**/*.gates.ts"],
    environment: "node",
  },
});
