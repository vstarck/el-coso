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

test("every declared manifest field survives the copy — the whole wire, pinned", () => {
  const [m] = tunableManifest([floatRule]);
  // deep equality, not a field-by-field check: this is what catches a DROPPED field,
  // which is the failure this file exists for. A key added here must be added above.
  expect(m).toEqual({
    path: ["temperature"], label: "temperature", group: "Run", type: "float",
    min: 0.5, max: 800, step: 0.5, public: true,
  });

  const [e] = tunableManifest([enumRule]);
  expect(e).toEqual({ path: ["source"], label: "Draw", group: "Look", type: "enum", options: ["a", "b"] });
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
