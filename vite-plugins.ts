import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

// Embeds live in el-coso/dist-embed regardless of which vite root imports this
// (this file sits at the el-coso root), so the private dev overlay — which runs
// from its own root — resolves the same directory. `examples/` sits alongside.
const DIST_EMBED = path.resolve(__dirname, "dist-embed");
const EXAMPLES = path.resolve(__dirname, "examples");

function contentType(file: string): string {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

// Dev-only: expose the exported embeds + the SDK demo, all served VERBATIM so
// vite's index-HTML transform / HMR client is never injected (the embeds must
// run exactly as deployed). `apply: "serve"` keeps this out of production
// builds. Build the artifacts first with `npm run export -- <id>`.
//
// Routes (config-independent — they work under el-coso's own root and under the
// private dev overlay's root alike, because the plugin owns the paths):
//   /embed/<id>     → dist-embed/<id>/<id>.html   (one standalone embed; legacy)
//   /embeds/<path>  → dist-embed/<path>           (sdk.js, embed.html, bundles)
//   /portfolio      → examples/portfolio.html     (the SDK Conductor demo)
export function serveEmbeds(): Plugin {
  return {
    name: "serve-embeds",
    apply: "serve",
    configureServer(server) {
      // The whole dist-embed tree (sdk.js, embed.html, <id>/<id>-embed.js, …) —
      // this is what the Conductor demo and any real host page load from.
      server.middlewares.use("/embeds", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = path.normalize(path.join(DIST_EMBED, rel));
        if (file !== DIST_EMBED && !file.startsWith(DIST_EMBED + path.sep)) {
          res.statusCode = 403; // path traversal
          res.end("forbidden");
          return;
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader("Content-Type", contentType(file));
        res.end(fs.readFileSync(file));
      });

      // The SDK Conductor demo (examples/portfolio.html) — open /portfolio.
      server.middlewares.use("/portfolio", (_req, res, next) => {
        const file = path.join(EXAMPLES, "portfolio.html");
        if (!fs.existsSync(file)) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(fs.readFileSync(file));
      });

      // A single standalone embed (kept for the dev toolbar's screenshot link).
      server.middlewares.use("/embed", (req, res, next) => {
        const id = (req.url ?? "").replace(/^\//, "").split("?")[0].replace(/\.html$/, "");
        if (!id) return next();
        const file = path.join(DIST_EMBED, id, `${id}.html`);
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end(`No embed built for "${id}". Run: npm run export -- ${id}`);
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end(fs.readFileSync(file));
      });
    },
  };
}
