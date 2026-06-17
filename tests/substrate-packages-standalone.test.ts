import { expect, test } from "vitest";

// Cold-import regression net. Each substrate package must be importable on
// its own — no chrome, no `session`, no pre-primed module graph — because
// tests, the headless runner, and the bare host all do exactly that.
//
// The failure this guards against: a lens that imports a session-
// reaching app module (`historyView.ts`, `bttf.ts`) closes a cycle
// `lens → session → substrates.ts → lens`. The package then crashes on
// standalone import with `Cannot read properties of undefined (reading
// 'id')` at the registry's `Package.meta.id`, because the registry
// evaluates against the half-built package namespace. The fix is for
// lenses to import the session-free `buildHistoryView.ts` instead; this
// test is the alarm if a future lens reaches for the coupled module again.
//
// Glob is eager: the failure is a module-eval throw at collection time, so
// it surfaces as a failed suite, not a failed assertion — which is the same
// shape as the original crash.

const PACKAGES = import.meta.glob("../src/substrates/*/index.ts", {
  eager: true,
}) as Record<string, { meta?: { id?: string }; bundle?: unknown; lenses?: unknown }>;

test("every substrate package imports standalone with a sound barrel", () => {
  const ids = Object.entries(PACKAGES).map(([path, mod]) => {
    // A package whose lens reached `session` would already have thrown
    // above (at glob eval). These assertions catch a subtler barrel error.
    expect(mod.meta, `${path}: missing meta`).toBeTruthy();
    expect(typeof mod.meta!.id, `${path}: meta.id not a string`).toBe("string");
    expect(mod.bundle, `${path}: missing bundle`).toBeTruthy();
    expect(mod.lenses, `${path}: missing lenses map`).toBeTruthy();
    return mod.meta!.id!;
  });

  // Sanity: we actually loaded the roster (not an empty glob), and pentris —
  // one of the packages that carried an import-cycle bug — is present.
  // (Its sibling moved private, with its own cold-import regression.)
  expect(ids.length).toBeGreaterThanOrEqual(5);
  expect(ids).toContain("pentris");

  // ids are unique — a duplicate would collide in the registry.
  expect(new Set(ids).size).toBe(ids.length);
});
