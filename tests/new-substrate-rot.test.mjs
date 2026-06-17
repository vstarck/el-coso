import { afterAll, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { generate } from "../scripts/new-substrate/generate.mjs";
import { removeSubstrate, nameForms } from "../scripts/new-substrate/core.mjs";
import { ROT_PROFILES } from "../scripts/new-substrate/rot-profiles.mjs";

// The rot-test (non-negotiable): a code
// generator silently rots against the contract. This generates the covering
// set of answer profiles and asserts the project type-checks — so the moment
// a template stops matching the engine/lens/history contracts, CI fails.
//
// Written as .mjs so tsc ignores it (it imports the untyped dev scripts) while
// vitest runs it. tsconfig include:["src","tests"] type-checks the generated
// packages directly (the glob roster is a bundler transform, irrelevant to tsc),
// and cleanup deletes the dirs — so nothing leaks into the committed tree.

const NAMES = Object.keys(ROT_PROFILES);

function cleanup() {
  for (const name of NAMES) removeSubstrate(nameForms(name));
}

afterAll(cleanup);

test("generated substrates type-check across the answer matrix", () => {
  cleanup(); // idempotent — clear any leftover from a crashed run
  try {
    for (const [name, answers] of Object.entries(ROT_PROFILES)) {
      generate(name, answers);
    }
    try {
      execSync("npx tsc --noEmit", { cwd: process.cwd(), stdio: "pipe" });
    } catch (e) {
      const out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      throw new Error("generated packages failed tsc:\n" + out);
    }
  } finally {
    cleanup();
  }
}, 120000);

const BARREL_EXPORTS = [
  "export const bundle",
  "export const adapter",
  "export const lenses",
  "export const defaultLensId",
  "export { parseLevel }",
  "export const puzzles",
  "export const meta",
];

test("every generated package exposes the registry barrel shape", () => {
  cleanup();
  try {
    for (const [name, answers] of Object.entries(ROT_PROFILES)) {
      const { dest } = generate(name, answers);
      const barrel = readFileSync(`${dest}/index.ts`, "utf8");
      for (const decl of BARREL_EXPORTS) {
        expect(barrel, `${name} barrel missing: ${decl}`).toContain(decl);
      }
    }
  } finally {
    cleanup();
  }
}, 60000);
