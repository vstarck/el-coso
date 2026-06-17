import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

// Embeds live in el-coso/dist-embed regardless of which vite root imports this
// (this file sits at the el-coso root), so the private dev overlay — which runs
// from its own root — resolves the same directory.
const DIST_EMBED = path.resolve(__dirname, "dist-embed");

// Dev-only: serve an exported embed (`dist-embed/<id>.html`) verbatim at
// `/embed/<id>`, bypassing vite's index-HTML transform — so the real, post-
// ready embed can be previewed/screenshotted alongside the editor. `apply:
// "serve"` keeps it out of production builds entirely. Build one first with
// `npm run export -- <id>`.
export function serveEmbeds(): Plugin {
  return {
    name: "serve-embeds",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/embed", (req, res, next) => {
        const id = (req.url ?? "").replace(/^\//, "").split("?")[0].replace(/\.html$/, "");
        if (!id) return next();
        const file = path.join(DIST_EMBED, `${id}.html`);
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
