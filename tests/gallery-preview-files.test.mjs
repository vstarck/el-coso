/* The gallery preview's FILES (S251): `previewFile` / `previewFiles` (vite-plugins.ts), the one resolver the dev
 * server, `vite preview` and a build share. `.mjs` because it needs node's fs, which el-coso's tsc does not type (the
 * convention of new-substrate-rot.test.mjs); the card half is gallery-preview.test.ts. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewFile, previewFiles } from "../vite-plugins";

describe("previewFile — /previews/<id>/<file> → <root>/<id>/preview/<file>", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "previews-"));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "previews-b-"));
  fs.mkdirSync(path.join(root, "wacha", "preview"), { recursive: true });
  fs.writeFileSync(path.join(root, "wacha", "preview", "still.webp"), "x");
  fs.mkdirSync(path.join(other, "faro", "preview"), { recursive: true });
  fs.writeFileSync(path.join(other, "faro", "preview", "clip.webm"), "y");
  fs.writeFileSync(path.join(root, "wacha", "secret.txt"), "no");
  const roots = [root, other];

  it("resolves a file in any root", () => {
    expect(previewFile(roots, "/previews/wacha/still.webp")).toBe(path.join(root, "wacha", "preview", "still.webp"));
    expect(previewFile(roots, "/previews/faro/clip.webm?v=1")).toBe(path.join(other, "faro", "preview", "clip.webm"));
  });
  const refused = [
    ["a missing file", "/previews/wacha/clip.webm"],
    ["an unknown substrate", "/previews/nobody/still.webp"],
    ["a parent-directory escape", "/previews/wacha/..%2Fsecret.txt"],
    ["a dotted escape in the id", "/previews/../wacha/preview/still.webp"],
    ["a nested path", "/previews/wacha/preview/still.webp"],
    ["a hidden file", "/previews/wacha/.still.webp"],
    ["another route", "/embeds/wacha/still.webp"],
  ];
  for (const [name, url] of refused) it(`refuses ${name}`, () => expect(previewFile(roots, url)).toBeNull());

  it("previewFiles lists every shipped file as its URL path (what a build copies)", () => {
    expect(previewFiles(roots).map((f) => f.url).sort()).toEqual(["previews/faro/clip.webm", "previews/wacha/still.webp"]);
  });
});
