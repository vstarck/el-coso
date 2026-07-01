/* Embed bundle config — builds a react-less, store-less substrate embed into
 * a standalone IIFE exposing `window.<Name>` with a mount function.
 *
 * Parameterized by env so one config builds any substrate (driven by
 * `scripts/export-embed.mjs`):
 *   COSO_EMBED_ENTRY  entry module (default: the blockoide bespoke entry)
 *   COSO_EMBED_NAME   IIFE global name (default: "Blockoide")
 *   COSO_EMBED_FILE   output filename (default: "blockoide-embed.js")
 *
 * The defaults preserve the original `npm run build:embed` (blockoide).
 * Separate from vite.config.ts: no React plugin, library mode, single entry,
 * output to `dist-embed/`. CSS is inlined (cssCodeSplit false); other assets
 * are base64-inlined so the bundle is a true single file — EXCEPT a substrate's
 * `assets/thumbnail.*`, which is a gallery-only card image the embed never
 * renders. The `externalizeThumbnail` plugin rewrites that import to a bare
 * basename string (`meta.thumbnail === "thumbnail.webp"`) so the bundle carries
 * no base64; `scripts/export-embed.mjs` copies the real file alongside the
 * bundle in `dist-embed/<id>/`, where the basename resolves as a sibling.
 */

import { defineConfig, type Plugin } from "vite";
import path from "node:path";

const ENTRY = process.env.COSO_EMBED_ENTRY ?? "src/embed/blockoide.ts";
const NAME = process.env.COSO_EMBED_NAME ?? "Blockoide";
const FILE = process.env.COSO_EMBED_FILE ?? "blockoide-embed.js";

// Substrate thumbnails are gallery card images (consumed by the app chrome via
// `meta.thumbnail`); the embed runtime never reads them. Inlining their base64
// into every embed bundle is dead weight, so resolve the import to just the
// filename — a sibling-relative reference the export script satisfies by copying
// the file into `dist-embed/<id>/`. Scoped to `assets/thumbnail.*` and to bare
// imports (no `?raw`/`?inline`/`?url` query) so nothing else is affected.
function externalizeThumbnail(): Plugin {
  return {
    name: "coso-externalize-thumbnail",
    enforce: "pre",
    load(id) {
      if (id.includes("?")) return null;
      if (/[\\/]assets[\\/]thumbnail\.(webp|png|jpe?g|gif|avif)$/i.test(id)) {
        return `export default ${JSON.stringify(path.basename(id))};`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [externalizeThumbnail()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: false,
    cssCodeSplit: false,
    // Base64-inline every asset into the JS for a true single file. (Blockoide
    // already inlines its CSS via `?inline` and has no other assets, so this
    // is a no-op there; generic substrates with imported images benefit.)
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    lib: {
      entry: path.resolve(__dirname, ENTRY),
      name: NAME,
      formats: ["iife"],
      fileName: () => FILE,
    },
  },
});
