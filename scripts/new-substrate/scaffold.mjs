/* new-substrate v0 — the "dumb scaffold" tier. Copies
 * src/substrates/example/, renames
 * Example→<Name> across every file (content + filenames). The roster is
 * glob-discovered, so the renamed package registers itself — nothing to patch.
 * No questions, no templating — the author then fills the physics / render /
 * puzzles.
 *
 * v1 (cli.mjs — the wizard: question manifest + templates + rot-test)
 * supersedes this and adds the per-answer toggles; v0 is the immediate,
 * low-risk path and the zero-dependency fallback if @clack isn't installed.
 *
 * Run: npm run new-substrate:v0 -- <name>      (name is kebab-case)
 */

import { nameForms, validateName, copyTree, SUBSTRATES_DIR } from "./core.mjs";
import { join } from "node:path";

function main() {
  const name = process.argv[2];
  const err = validateName(name);
  if (err) {
    console.error(err);
    console.error("usage: npm run new-substrate:v0 -- <name>   (kebab-case, e.g. light-cycles)");
    process.exit(1);
  }

  const forms = nameForms(name);
  copyTree(join(SUBSTRATES_DIR, name), { forms, answers: {} }); // no templates → pure renamed example

  console.log(`✓ scaffolded src/substrates/${name}/ (copied from example/, renamed)`);
  console.log(`✓ auto-registered via the glob roster (src/app/substrates.ts)`);
  console.log("");
  console.log("Next — fill the verbs the scaffold can't write for you:");
  console.log("  • engine/  — the real tick (physics), state shape, channels, commit payload");
  console.log("  • lens/    — render + input wiring (walk the six design questions)");
  console.log("  • puzzles/ — replace the placeholder level");
  console.log("");
  console.log(`Verify:  npx tsc --noEmit && npx vitest run   ·   open ?substrate=${name}`);
}

main();
