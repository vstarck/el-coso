/* new-substrate v1 — the wizard CLI. Two entry paths:
 *
 *   npm run new-substrate -- <name>                 interactive (@clack)
 *   npm run new-substrate -- <name> --from a.json   non-interactive
 *
 * The non-interactive path is dependency-free (the rot-test drives the same
 * generate() core). @clack/prompts is lazy-imported only for the
 * interactive path, so `--from` works even if @clack isn't installed.
 */

import { readFileSync } from "node:fs";
import { generate } from "./generate.mjs";
import { QUESTIONS, EXAMPLE_PROFILE } from "./questions.mjs";
import { validateName } from "./core.mjs";

function parseArgs(argv) {
  let name;
  let fromPath;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") fromPath = argv[++i];
    else if (!a.startsWith("--") && name === undefined) name = a;
  }
  return { name, fromPath };
}

function printNext(forms) {
  console.log("");
  console.log("Next — fill the verbs the scaffold can't write for you:");
  console.log("  • engine/  — the real tick (physics), state, channels, commit payload");
  console.log("  • lens/    — the real render + input");
  console.log("  • puzzles/ — replace the placeholder level");
  console.log(`  • ${forms.kebab}/DESIGN.md records your six answers`);
  console.log("");
  console.log(`Verify:  npx tsc --noEmit && npx vitest run   ·   open ?substrate=${forms.kebab}`);
}

function runFromFile(name, fromPath) {
  const answers = JSON.parse(readFileSync(fromPath, "utf8"));
  const { forms } = generate(name, answers); // validates name + answers, throws on error
  console.log(`✓ scaffolded src/substrates/${name}/ + registered ${forms.pascal}`);
  printNext(forms);
}

async function runInteractive(initialName) {
  let p;
  try {
    p = await import("@clack/prompts");
  } catch {
    console.error("Interactive mode needs @clack/prompts:");
    console.error("  npm install -D @clack/prompts");
    console.error("Or run non-interactively:");
    console.error("  npm run new-substrate -- <name> --from answers.json");
    console.error(`(answers.json keys: ${QUESTIONS.map((q) => q.id).join(", ")})`);
    process.exit(1);
  }

  const bail = (v) => {
    if (p.isCancel(v)) {
      p.cancel("cancelled");
      process.exit(0);
    }
    return v;
  };

  p.intro("new-substrate — scaffold a substrate package");

  let name = initialName;
  if (!name) {
    name = bail(
      await p.text({
        message: "Substrate name (kebab-case)",
        placeholder: "light-cycles",
        validate: (v) => validateName(v) ?? undefined,
      }),
    );
  } else {
    const err = validateName(name);
    if (err) {
      p.cancel(err);
      process.exit(1);
    }
  }

  const answers = {};
  for (const q of QUESTIONS) {
    answers[q.id] = bail(
      await p.select({
        message: `${q.docQ} — ${q.prompt}`,
        initialValue: EXAMPLE_PROFILE[q.id],
        options: q.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
      }),
    );
  }

  const go = bail(await p.confirm({ message: `Scaffold src/substrates/${name}/ with these answers?` }));
  if (!go) {
    p.cancel("cancelled");
    process.exit(0);
  }

  const { forms } = generate(name, answers);
  p.outro(`✓ scaffolded src/substrates/${name}/ + registered ${forms.pascal}`);
  printNext(forms);
}

async function main() {
  const { name, fromPath } = parseArgs(process.argv.slice(2));
  try {
    if (fromPath) {
      if (!name) throw new Error("a name is required with --from: npm run new-substrate -- <name> --from answers.json");
      runFromFile(name, fromPath);
    } else {
      await runInteractive(name);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

await main();
