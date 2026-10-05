/* THE WIRE BETWEEN A LENS AND A HOST, gated at the FAR end.
 *
 * `tunableManifest` is the only translation from a lens's `Rule` to what an embed host
 * receives, and it copies FIELD BY FIELD. That shape has one silent failure: a property
 * added to `Rule` and to `TunableManifest` but not to the copy type-checks perfectly,
 * ships, and arrives at every host as `undefined`. Nothing else in this repo would catch
 * it — review protects components, and this is wiring.
 *
 * So these rows assert the manifest a host actually gets, not the types that describe it.
 */
import { expect, test } from "vitest";
import { tunableManifest } from "@/embed/sdk/runtime";
import type { LensTunable } from "@/lenses/types";

const floatRule: LensTunable = {
  target: "lens", path: ["temperature"], id: "temperature", group: "Run",
  label: "temperature", type: "float", min: 0.5, max: 800, step: 0.5, public: true,
};
const enumRule: LensTunable = {
  target: "lens", path: ["source"], id: "source", group: "Look",
  label: "Draw", type: "enum", options: ["a", "b"],
};
/* An enum whose options split into a public subset and a labs remainder — the
 * `preset` knob's shape. S203. */
const splitEnumRule: LensTunable = {
  target: "lens", path: ["preset"], id: "preset", group: "Preset",
  label: "Load world", type: "enum", options: ["shown", "hidden"],
  public: true, public_options: ["shown"],
};

test("every declared manifest field survives the copy — the whole wire, pinned", () => {
  const [m] = tunableManifest([floatRule]);
  // deep equality, not a field-by-field check: this is what catches a DROPPED field,
  // which is the failure this file exists for. A key added here must be added above.
  expect(m).toEqual({
    path: ["temperature"], label: "temperature", group: "Run", type: "float",
    min: 0.5, max: 800, step: 0.5, public: true,
    id: "temperature", target: "lens", // spec/32 D3 (S248): the declaration's own id and target now ride the wire
  });

  const [e] = tunableManifest([enumRule]);
  expect(e).toEqual({ path: ["source"], label: "Draw", group: "Look", type: "enum", options: ["a", "b"], id: "source", target: "lens" });
});

/* ⚠ ABSENT IS NOT `false`, AND A HOST MUST BE ABLE TO TELL. An embed built before this
 * field existed omits it, so the contract is "read `=== true`". These two rows are what
 * make that contract testable rather than a sentence in a comment. */
test("`public` reaches a host only when the lens says so, and absence stays absent", () => {
  const [on] = tunableManifest([floatRule]);
  expect(on!.public).toBe(true);

  const [off] = tunableManifest([enumRule]);
  expect(off!.public).toBeUndefined();
  expect("public" in off!, "an absent flag must not be materialised as a key").toBe(false);

  // the control: the copy is not simply dropping everything it is not asked about —
  // `enumRule` carries options through the same call, so the row above is about `public`
  expect(off!.options).toEqual(["a", "b"]);
});

/* The non-degeneracy: a rule declared `public: false` must read the same as one that
 * says nothing, because the host contract is `=== true`. If this ever needs to change —
 * a host wanting to distinguish "hidden on purpose" from "did not say" — it is a
 * protocol change, not a copy tweak. */
test("an explicit `public: false` is carried as absence, like saying nothing", () => {
  const [m] = tunableManifest([{ ...floatRule, public: false }]);
  expect("public" in m!).toBe(false);
});

/* ── `public_options` (S203) ──────────────────────────────────────────────────
 * `Rule.public` says whether a KNOB belongs on a public surface. For an enum
 * that is not enough: `preset` is public, but some of the worlds it can load are
 * labs-only. `public_options` is the same idea one level down — the subset of
 * `options` a public surface should OFFER, while every option stays settable by
 * id so the console and a labs page keep the whole list.
 *
 * ⚠ It is a HINT, not a filter. `options` is unchanged and remains the
 * validation set; a host that ignores `public_options` behaves exactly as
 * before. That is why the first row below asserts both arrays arrive.
 */

test("`public_options` reaches the host BESIDE the full options, not instead of them", () => {
  const [m] = tunableManifest([splitEnumRule]);
  expect(m!.options).toEqual(["shown", "hidden"]);
  expect(m!.public_options).toEqual(["shown"]);
});

test("the whole wire for a split enum, pinned by deep equality", () => {
  const [m] = tunableManifest([splitEnumRule]);
  expect(m).toEqual({
    path: ["preset"], label: "Load world", group: "Preset", type: "enum",
    public: true, options: ["shown", "hidden"], public_options: ["shown"],
    id: "preset", target: "lens",
  });
});

/* Absent stays absent, same contract as `public`: an embed built before this
 * field existed omits it, and a host must read it as "this guest does not say"
 * — which means "offer everything", the pre-S203 behaviour. */
test("an enum that says nothing carries no `public_options` key at all", () => {
  const [m] = tunableManifest([enumRule]);
  expect("public_options" in m!, "an absent hint must not be materialised").toBe(false);
});

/* Control: the copy is by VALUE, not by reference. A host mutating what it was
 * handed must not reach back into the lens's own declaration. */
test("the host gets a copy it cannot use to mutate the lens's declaration", () => {
  const [m] = tunableManifest([splitEnumRule]);
  m!.public_options!.push("smuggled");
  expect(splitEnumRule.type === "enum" && splitEnumRule.public_options).toEqual(["shown"]);
});


/* spec/32 D3 — the wire was a hand-written field copy that dropped id, target, display, curve and unit. ONE fixture
 * per Rule variant with EVERY optional field set; the row asserts each declared key arrives. A key added to `Rule` and
 * to this fixture but not to the copy reddens here. */
const FULL: LensTunable[] = [
  { id: "f", group: "G", label: "F", public: true, type: "float", min: 0, max: 1, step: 0.1, curve: "signed-cubic", unit: "px", target: "config", path: ["f"] },
  { id: "i", group: "G", label: "I", public: true, type: "int", min: 0, max: 9, step: 1, unit: "n", target: "lens", path: ["i"] },
  { id: "b", group: "G", label: "B", public: true, type: "bool", target: "lens", path: ["b"] },
  { id: "e", group: "G", label: "E", public: true, type: "enum", options: ["a", "b", "c"], public_options: ["a"], display: "list", target: "config", path: ["e"] },
];
test("D3 — every key a Rule declares reaches the manifest", () => {
  const m = tunableManifest(FULL);
  FULL.forEach((t, i) => {
    for (const k of Object.keys(t)) expect(m[i], `${t.id}.${k}`).toHaveProperty(k);
  });
});
test("D3 — the manifest copies, it does not alias (a host mutating options cannot reach the lens)", () => {
  const m = tunableManifest(FULL);
  m[3]!.options!.push("z");
  m[0]!.path.push("x");
  expect(FULL[3]).toMatchObject({ options: ["a", "b", "c"] });
  expect(FULL[0]!.path).toEqual(["f"]);
});
