/* new-substrate — shared scaffolding engine. Used by both v0
 * (scaffold.mjs, no questions) and v1 (the wizard: generate.mjs + cli.mjs).
 *
 * Dependency-free ESM so it runs under plain `node` and imports cleanly
 * into vitest (the rot-test) with no TS runner — scripts/ is dev-only,
 * outside the engine's translatable boundary.
 */

import { readdirSync, statSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const TEMPLATE_DIR = join(ROOT, "src", "substrates", "example");
export const SUBSTRATES_DIR = join(ROOT, "src", "substrates");

// --- name forms -------------------------------------------------------------

// kebab "my-substrate" → { kebab, camel, pascal, title }. The template uses
// `example` as a camelCase identifier fragment (exampleBundle), a kebab
// string/path (example-grid), and `Example` as a PascalCase type/namespace —
// so the rename needs all three, plus a Title Case display label.
export function nameForms(kebab) {
  const words = kebab.split("-");
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  const camel = pascal[0].toLowerCase() + pascal.slice(1);
  const title = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return { kebab, camel, pascal, title };
}

// Apply all three renames to a string (file content or a filename). Order
// matters: Pascal first (capital E is unambiguous), then the lowercase
// camelCase fragments (followed by an upper-case letter or digit), then the
// remaining lowercase `example` → kebab.
export function rename(str, f) {
  return str
    .replaceAll("Example", f.pascal)
    .replace(/example(?=[A-Z0-9])/g, f.camel)
    .replaceAll("example", f.kebab);
}

export function validateName(name) {
  if (!name) return "missing name";
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    return `invalid name "${name}". Use lowercase kebab-case: a letter, then letters/digits/hyphens.`;
  }
  if (existsSync(join(SUBSTRATES_DIR, name))) return `substrate "${name}" already exists`;
  return null;
}

// --- copy with optional per-file template overrides -------------------------

// Walk the example template, writing each file to dest. For a file whose
// relative path is a key in `templates`, the template fn(ctx) produces the
// content (the answer-toggled file); every other file falls back to the
// renamed example content (so example/ stays the single source for the
// files no answer affects). Filenames are renamed in all cases.
//
// ctx = { forms, answers }. Returns the list of written dest paths.
export function copyTree(destDir, ctx, templates = {}) {
  const written = [];
  walk(TEMPLATE_DIR, destDir, "", ctx, templates, written);
  return written;
}

function walk(srcDir, destDir, rel, ctx, templates, written) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const relPath = rel ? `${rel}/${entry}` : entry;
    const destEntry = rename(entry, ctx.forms);
    const destPath = join(destDir, destEntry);
    if (statSync(srcPath).isDirectory()) {
      walk(srcPath, destPath, relPath, ctx, templates, written);
    } else {
      const tmpl = templates[relPath];
      let content;
      if (tmpl) {
        content = tmpl(ctx);
        if (content === null) continue; // template opts this file out (e.g. channels.ts when storage=plain)
      } else {
        content = rename(readFileSync(srcPath, "utf8"), ctx.forms);
        // Nicety: upgrade the renamed meta.name token to a Title Case label.
        content = content.replace(`name: "${ctx.forms.pascal}"`, `name: "${ctx.forms.title}"`);
      }
      writeFileSync(destPath, content);
      written.push(destPath);
    }
  }
}

// --- unscaffold -------------------------------------------------------------

// Remove a substrate's package dir. The roster is glob-discovered from
// `src/substrates/<name>/index.ts` (src/app/substrates.ts), so deleting the dir
// fully unregisters it — there is no registry file to unpatch. Used by the
// rot-test cleanup and available for manual unscaffolding.
export function removeSubstrate(forms) {
  const dir = join(SUBSTRATES_DIR, forms.kebab);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
