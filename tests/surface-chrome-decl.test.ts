/* spec/32 §5.1, §6 — the dashboard declaration. Every refusal is pinned on its REASON (CLAUDE.md §C: asserting that
 * it threw is not asserting why). */
import { describe, expect, test } from "vitest";
import { controlIds, defaultDashboard, extend, validateControls, validateDashboard, validateFlyout, type Dashboard } from "@/surface/chrome";

const base = (): Dashboard => ({ slots: {}, behaviour: { idleSeconds: 2.5 }, theme: {}, footer: null });
const btn = (id: string) => ({ kind: "button" as const, id, label: id, icon: "<svg/>" });

describe("validateDashboard — refusals, each on its reason", () => {
  const cases: [string, unknown, RegExp][] = [
    ["unknown top-level key", { ...base(), slotz: {} }, /dashboard: unknown key "slotz"/],
    ["unknown slot", { ...base(), slots: { middle: { controls: [] } } }, /dashboard slots: unknown key "middle"/],
    ["unknown slot key (a typo)", { ...base(), slots: { left: { contorls: [] } } }, /slots\.left: unknown key "contorls"/],
    ["unknown control kind", { ...base(), slots: { left: { controls: [{ kind: "knob", id: "a", label: "a" }] } } }, /slots\.left\.controls\[0\]: unknown kind "knob"/],
    ["unknown control key", { ...base(), slots: { left: { controls: [{ ...btn("a"), colour: "red" }] } } }, /controls\[0\]: unknown key "colour"/],
    ["duplicate id across slots", { ...base(), slots: { left: { controls: [btn("a")] }, right: { controls: [btn("a")] } } }, /slots\.right\.controls\[0\]: duplicate id "a"/],
    ["an id unsafe for data-role", { ...base(), slots: { left: { controls: [btn("A b")] } } }, /controls\[0\]: id "A b" must match/],
    ["empty cycle", { ...base(), slots: { left: { controls: [{ kind: "cycle", id: "c", label: "c", states: [] }] } } }, /controls\[0\]: a cycle needs at least one state/],
    ["vignette on a slot without one", { ...base(), slots: { "top-left": { controls: [], vignette: true } } }, /slots\.top-left: no vignette is defined for "top-left"/],
    ["idle out of range", { ...base(), behaviour: { idleSeconds: 0 } }, /behaviour\.idleSeconds: 0 is outside 1…30/],
    ["unknown theme key", { ...base(), theme: { ink: "#fff" } }, /dashboard theme: unknown key "ink"/],
    ["accent not a hex colour", { ...base(), theme: { accent: "rust" } }, /theme\.accent: "rust" is not #rrggbb/],
    ["a footer without a QR", { ...base(), footer: { sources: [], qr: null, caption: "x" } }, /footer\.qr: a footer without a QR has no consumer yet/],
  ];
  for (const [name, d, re] of cases) test(name, () => expect(() => validateDashboard(d as Dashboard)).toThrow(re));
});

describe("extend", () => {
  test("appends to an existing slot and adds a new one; the base is untouched", () => {
    const b = defaultDashboard();
    const before = JSON.stringify(controlIds(b));
    const d = extend(b, { slots: { left: { controls: [btn("world")] }, bottom: { controls: [btn("extra")] } } });
    expect(controlIds(d)).toEqual(expect.arrayContaining(["world", "extra", "restart", "play", "step"]));
    expect(JSON.stringify(controlIds(b))).toBe(before);
  });
  test("an id collision is refused and names `replace`", () => {
    expect(() => extend(defaultDashboard(), { slots: { left: { controls: [btn("download")] } } })).toThrow(/id "download" already exists — use replace\.controls/);
  });
  test("replace.controls swaps in place; an unknown id there is refused", () => {
    const d = extend(defaultDashboard(), { replace: { controls: [{ ...btn("download"), label: "save" }] } });
    expect(JSON.stringify(d)).toContain('"label":"save"');
    expect(() => extend(defaultDashboard(), { replace: { controls: [btn("nope")] } })).toThrow(/replace\.controls: no control "nope" to replace/);
  });
  test("re-declaring an existing slot's settings needs replace.slots", () => {
    expect(() => extend(defaultDashboard(), { slots: { bottom: { controls: [], vignette: false } } })).toThrow(/slots\.bottom: already declared — use replace\.slots/);
  });
  test("remove drops an id; removing an unknown id is refused", () => {
    expect(controlIds(extend(defaultDashboard(), { remove: ["step"] }))).not.toContain("step");
    expect(() => extend(defaultDashboard(), { remove: ["nope"] })).toThrow(/remove: no control "nope"/);
  });
  test("an unknown patch key is refused", () => {
    expect(() => extend(defaultDashboard(), { slotz: {} } as never)).toThrow(/patch: unknown key "slotz"/);
  });
});

describe("defaultDashboard — the minimal swarm-like post (spec/32 §6)", () => {
  test("transport at the bottom, the eye top-left, download top-right, no footer, valid", () => {
    const d = defaultDashboard();
    expect(d.slots.bottom!.controls.map((c) => c.id)).toEqual(["restart", "play", "step"]);
    expect(d.slots["top-left"]!.controls.map((c) => c.id)).toEqual(["ui-mode"]);
    expect(d.slots["top-right"]!.controls.map((c) => c.id)).toEqual(["download"]);
    expect(d.footer).toBeNull();
    expect(() => validateDashboard(d)).not.toThrow();
  });
  test("each call is a fresh object (a consumer's extend cannot leak into the next)", () => {
    expect(defaultDashboard()).not.toBe(defaultDashboard());
    expect(defaultDashboard().slots.bottom).not.toBe(defaultDashboard().slots.bottom);
  });
});

/* S248 — the mid-plan review's findings (C1, C2, I1, I2, I3, I4), each a row that reddened before its fix. */
describe("review findings — refusals that must follow the keys down", () => {
  const custom = { kind: "custom" as const, id: "c", label: "c", mount: () => () => {} };
  const cases: [string, () => unknown, RegExp][] = [
    ["C1 extend: a misspelled slot", () => extend(defaultDashboard(), { slots: { lefft: { controls: [btn("x")] } } } as never), /patch\.slots: unknown key "lefft"/],
    ["C1 extend: slots not an object", () => extend(defaultDashboard(), { slots: null } as never), /patch\.slots: not an object/],
    ["C2 extend: an unknown key in an appended slot", () => extend(defaultDashboard(), { slots: { bottom: { controls: [btn("x")], vignete: true } } } as never), /patch\.slots\.bottom: unknown key "vignete"/],
    ["C2 extend: an appended slot's controls not an array", () => extend(defaultDashboard(), { slots: { bottom: { controls: "x" } } } as never), /patch\.slots\.bottom\.controls: not an array/],
    ["I1 a boolean field that is not a boolean", () => validateDashboard({ ...base(), slots: { left: { controls: [{ ...btn("a"), hidden: "no" }] } } } as never), /controls\[0\]\.hidden: not a boolean/],
    ["I1 big that is not a boolean", () => validateDashboard({ ...base(), slots: { left: { controls: [{ ...btn("a"), big: "false" }] } } } as never), /controls\[0\]\.big: not a boolean/],
    ["I1 a truthy non-boolean vignette", () => validateDashboard({ ...base(), slots: { "top-left": { controls: [], vignette: 1 } } } as never), /slots\.top-left\.vignette: not a boolean/],
    ["I1 a source icon that is not an image", () => validateDashboard({ ...base(), footer: { sources: [{ mark: "m", tint: "#000", title: "t", detail: "d", icon: "nope" }], qr: { url: "u", rows: Array(21).fill("0".repeat(21)) }, caption: "c" } } as never), /footer\.sources\[0\]\.icon: not an image/],
    ["I1 a glyph with a typo'd key", () => validateDashboard({ ...base(), footer: { sources: [{ mark: "m", tint: "#000", title: "t", detail: "d", glyph: { d: "M0 0", size: 24, ink: "#000" } }], qr: { url: "u", rows: Array(21).fill("0".repeat(21)) }, caption: "c" } } as never), /footer\.sources\[0\]\.glyph: unknown key "size"/],
    ["I1 replace.footer without a footer", () => extend(defaultDashboard(), { replace: { footer: true } }), /replace\.footer: no footer given/],
    ["I2 a kind named after an Object.prototype member", () => validateDashboard({ ...base(), slots: { left: { controls: [{ kind: "constructor", id: "a", label: "a" }] } } } as never), /unknown kind "constructor"/],
    ["I2 remove given a string", () => extend(defaultDashboard(), { remove: "restart" } as never), /patch\.remove: not an array/],
    ["I2 replace.controls holding a non-object", () => extend(defaultDashboard(), { replace: { controls: [null] } } as never), /replace\.controls\[0\]: not an object/],
    ["I3 disabled on a custom control (nothing honours it)", () => validateDashboard({ ...base(), slots: { left: { controls: [{ ...custom, disabled: true }] } } } as never), /controls\[0\]: unknown key "disabled"/],
    ["I4 an id the chrome reserves", () => validateDashboard({ ...base(), slots: { left: { controls: [btn("flyout")] } } }), /controls\[0\]: id "flyout" is reserved by the chrome/],
    ["I4 an id with a reserved prefix", () => validateDashboard({ ...base(), slots: { left: { controls: [btn("label-x")] } } }), /controls\[0\]: id "label-x" is reserved by the chrome/],
  ];
  for (const [name, f, re] of cases) test(name, () => expect(f).toThrow(re));
});

describe("review findings — the extend rows assert what they name (I6)", () => {
  test("replace.controls swaps IN PLACE (same slot, same index)", () => {
    const d = extend(defaultDashboard(), { replace: { controls: [{ ...btn("download"), label: "save" }] } });
    expect(d.slots["top-right"]!.controls[0]).toMatchObject({ id: "download", label: "save" });
  });
  test("the base is untouched — whole declaration, not only its ids", () => {
    const b = defaultDashboard();
    const before = JSON.stringify(b);
    extend(b, { slots: { left: { controls: [btn("world")] }, bottom: { controls: [btn("extra")] } }, theme: { accent: "#c96a3f" }, remove: ["step"] });
    expect(JSON.stringify(b)).toBe(before);
  });
});

/* S248 — a toggle may carry STATES (its face: icon + label), independent of on/off: swarm-swart-grid's brush is one
 * toggle whose tool (melt / paint) follows the view. Found porting it (spec/32 §9.1 step 2): the old chrome kept the
 * tool in a data attribute the smoke reads. */
describe("toggle states", () => {
  const tog = (states: unknown) => ({ ...base(), slots: { left: { controls: [{ kind: "toggle", id: "brush", label: "melt", icon: "<svg/>", states }] } } });
  test("a toggle with states validates", () => {
    expect(() => validateDashboard(tog([{ id: "melt", icon: "<svg/>", label: "melt" }, { id: "paint", icon: "<svg/>", label: "paint" }]) as never)).not.toThrow();
  });
  test("its states are walked like a cycle's", () => {
    expect(() => validateDashboard(tog([{ id: "melt", icon: "<svg/>", label: "melt" }, { id: "melt", icon: "<svg/>", label: "x" }]) as never)).toThrow(/states\[1\]: duplicate state "melt"/);
    expect(() => validateDashboard(tog([]) as never)).toThrow(/a toggle's states, when given, need at least one/);
  });
});

describe("slider", () => {
  const s = { kind: "slider", id: "s", label: "s", min: 0, max: 1, step: 0.1 };
  const sl = (o: object) => validateControls([{ ...s, ...o }], "flyout", new Set());
  test("a slider validates", () => expect(() => sl({})).not.toThrow());
  test("min must be below max", () => expect(() => sl({ min: 2 })).toThrow(/controls\[0\]: min 2 is not below max 1/));
  test("step must be positive", () => expect(() => sl({ step: 0 })).toThrow(/controls\[0\]\.step: not a positive number/));
  test("an unknown slider key is refused", () => expect(() => sl({ curve: "x" })).toThrow(/controls\[0\]: unknown key "curve"/));
  test("a missing bound is refused by name", () => expect(() => sl({ max: undefined })).toThrow(/controls\[0\]\.max: not a finite number/));
  // S251 (deferred minor of S249): a slot slider had no reader — its cell carried two labels and its layout was never
  // exercised. Refused until a consumer needs one; the flyout is where wacha's live
  test("a slider in a SLOT is refused, on its reason", () => {
    expect(() => validateDashboard({ ...base(), slots: { left: { controls: [s] } } } as never))
      .toThrow(/slots\.left\.controls\[0\]: a slider lives in a controls flyout, not a slot/);
  });
});

describe("validateFlyout — a flyout's own keys are refused at every level (S251)", () => {
  const item = { id: "w", label: "w", active: false };
  const pick = { title: "t", items: [item], onPick: () => {} };
  const cases: [string, unknown, RegExp][] = [
    ["an unknown key on a picker flyout", { ...pick, onpick: () => {} }, /flyout: unknown key "onpick"/],
    ["an unknown key on a controls flyout", { title: "t", controls: [], items: [] }, /flyout: unknown key "items"/],
    ["an unknown item key (a typo)", { ...pick, items: [{ ...item, tittle: "x" }] }, /flyout\.items\[0\]: unknown key "tittle"/],
    ["an item whose active is not a boolean", { ...pick, items: [{ ...item, active: "false" }] }, /flyout\.items\[0\]\.active: not a boolean/],
    ["a picker with no onPick", { title: "t", items: [] }, /flyout\.onPick: not a function/],
    ["a duplicate item id", { ...pick, items: [item, item] }, /flyout\.items\[1\]: duplicate id "w"/],
  ];
  for (const [name, f, re] of cases) test(name, () => expect(() => validateFlyout(f, new Set())).toThrow(re));
  test("a valid picker and a valid controls flyout pass", () => {
    expect(() => validateFlyout({ ...pick, items: [{ ...item, title: "a note" }] }, new Set())).not.toThrow();
    expect(() => validateFlyout({ title: "t", controls: [{ kind: "slider", id: "s", label: "s", min: 0, max: 1, step: 0.1 }] }, new Set())).not.toThrow();
  });
});

describe("validateControls — a flyout's controls get the dashboard's refusals (S249 ruling)", () => {
  const s = { kind: "slider", id: "s", label: "s", min: 0, max: 1, step: 0.1 };
  test("valid controls pass", () => expect(() => validateControls([s], "flyout", new Set(["play"]))).not.toThrow());
  test("an id the dashboard already holds is refused", () => expect(() => validateControls([{ ...s, id: "play" }], "flyout", new Set(["play"]))).toThrow(/flyout\.controls\[0\]: duplicate id "play"/));
  test("a slider's keys are walked", () => expect(() => validateControls([{ ...s, min: 3 }], "flyout", new Set())).toThrow(/flyout\.controls\[0\]: min 3 is not below max 1/));
  test("the caller's id set is not mutated", () => { const ids = new Set<string>(); validateControls([s], "flyout", ids); expect(ids.size).toBe(0); });
});
