/* spec/32 §5.2 — bindings: a control tied to a tunable through the lens's own funnel (A2 Task 2, S249). A fake chrome
 * (it enforces the REAL patch-key table, imported from the renderer, so a patch the chrome would refuse fails here too)
 * and a fake tunable surface (a Map; every write notifies; one knob throws). Refusals are pinned on their REASON. */
import { describe, expect, test } from "vitest";
import type { LensTunable, TunableValue } from "@/lenses/types";
import { bind, CONTROL_PATCH_KEYS, type Binding, type Chrome, type Control, type ControlPatch, type Dashboard } from "@/surface/chrome";

const slider = (id: string, min: number, max: number, step: number): Control => ({ kind: "slider", id, label: id, min, max, step });
const states = (...ids: string[]) => ids.map((id) => ({ id, icon: "<svg/>", label: id }));
const dash = (over: Partial<Record<string, Control>> = {}): Dashboard => ({
  slots: {
    left: { controls: [
      over["view-a"] ?? { kind: "thumb", id: "view-a", label: "a" },
      over["view-b"] ?? { kind: "thumb", id: "view-b", label: "b" },
      over.sound ?? { kind: "toggle", id: "sound", label: "sound", icon: "<svg/>", states: states("off", "on") },
      over.grid ?? { kind: "cycle", id: "grid", label: "grid", states: states("single", "palettes", "readings") },
      over.eye ?? { kind: "cycle", id: "eye", label: "eye", states: states("auto", "always_on") },
    ] },
  },
  behaviour: { idleSeconds: 2.5 }, theme: {}, footer: null,
});
// a slider lives in a controls flyout only (S251: a slot slider has no reader, and the declaration refuses it)
const flyCtl = (over: Partial<Record<string, Control>> = {}): Control[] =>
  [over.tempo ?? slider("tempo", 4, 30, 1), over.fog ?? slider("fog", 0, 1, 0.1), over.zoom ?? slider("zoom", 1, 3, 0.5)];
const FLY = flyCtl();
const T = (r: Partial<LensTunable> & { id: string; type: LensTunable["type"] }): LensTunable =>
  ({ target: "lens", path: [r.id], group: "g", label: r.id, ...r }) as LensTunable;
const TUNABLES: LensTunable[] = [
  T({ id: "dance_fps", type: "int", min: 4, max: 30, step: 1 }),
  T({ id: "zoom", type: "float", min: 0.5, max: 3, step: 0.05 }),
  T({ id: "source", type: "enum", options: ["a", "b", "c"] }),
  T({ id: "sound", type: "bool" }),
  T({ id: "grid", type: "int", min: 1, max: 3, step: 1 }),
  T({ id: "grid_mode", type: "enum", options: ["views", "hue", "readings"] }),
  T({ id: "ui_mode", type: "enum", options: ["auto", "always_on", "always_on+labels"] }),
  T({ id: "soft_radius", type: "int", min: 0, max: 6, step: 1 }),
  T({ id: "trail", type: "float", min: 0.03, max: 1, step: 0.01 }),
  T({ id: "flaky", type: "float", min: 0, max: 30, step: 1 }),
];
const GRID: Record<string, Record<string, TunableValue>> = {
  single: { grid: 1, grid_mode: "views" }, palettes: { grid: 3, grid_mode: "hue" }, readings: { grid: 3, grid_mode: "readings" },
};
// a toy fog: f in tenths ↔ (soft_radius, trail); exact at the tenths, so its round trip holds
const fogMap = (f: number) => ({ soft_radius: Math.round(f * 5), trail: Math.round((1 - f * 0.5) * 100) / 100 });
const fogOf = (v: Record<string, TunableValue>) => Math.round((1 - Number(v.trail)) * 2 * 10) / 10;
const BIND: Record<string, Binding> = {
  "view-a": { knob: "source", value: "a" },
  "view-b": { knob: "source", value: "b" },
  sound: { knob: "sound" },
  grid: { knobs: ["grid", "grid_mode"], states: GRID },
  eye: { knob: "ui_mode" },
  zoom: { knob: "zoom" },
  tempo: { knob: "dance_fps" },
  fog: { knobs: ["soft_radius", "trail"], map: fogMap, unmap: fogOf },
};

function world(d: Dashboard = dash(), fly: Control[] = FLY, present: string[] = []) {
  const log: string[] = [];
  const values = new Map<string, TunableValue>([
    ["dance_fps", 14], ["zoom", 1], ["source", "a"], ["sound", false], ["grid", 1], ["grid_mode", "views"],
    ["ui_mode", "auto"], ["soft_radius", 0], ["trail", 1], ["flaky", 0],
  ]);
  const listeners = new Set<() => void>();
  const surface = {
    getTunable: (p: string[]) => values.get(p[0]!),
    setTunable: (p: string[], v: TunableValue) => {
      if (p[0] === "flaky") throw new Error("flaky: refused");
      values.set(p[0]!, v);
      log.push(`write ${p[0]}=${String(v)}`);
      log.push("notify");
      for (const l of listeners) l();
    },
    subscribeTunables: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
  const kinds = new Map<string, Control["kind"]>();
  for (const s of Object.values(d.slots)) for (const c of s!.controls) kinds.set(c.id, c.kind);
  for (const c of fly) kinds.set(c.id, c.kind);
  const ids = new Set([...Object.values(d.slots).flatMap((s) => s!.controls.map((c) => c.id)), ...present]);
  const sets: [string, ControlPatch][] = [];
  const chrome = {
    has: (id: string) => ids.has(id),
    set: (id: string, patch: ControlPatch) => {
      if (!ids.has(id)) throw new Error(`chrome: no control "${id}"`);
      for (const k of Object.keys(patch)) {
        if (!(CONTROL_PATCH_KEYS[kinds.get(id)!] as readonly string[]).includes(k)) throw new Error(`chrome: "${id}" (${kinds.get(id)}) has no ${k}`);
      }
      sets.push([id, patch]);
      log.push(`set ${id} ${JSON.stringify(patch)}`);
    },
  } as unknown as Chrome;
  return { log, values, surface, chrome, ids, sets, listeners, d, fly };
}
const mount = (w: ReturnType<typeof world>, b: Record<string, Binding> = BIND) => bind(w.chrome, w.d, TUNABLES, w.surface, b, w.fly);
const lastSet = (w: ReturnType<typeof world>, id: string) => w.sets.filter(([i]) => i === id).at(-1)?.[1];

describe("bind — refusals at mount, each on its reason", () => {
  const cases: [string, () => unknown, RegExp][] = [
    ["a binding for an id no control has", () => mount(world(), { ...BIND, nope: { knob: "sound" } }), /bind: no control "nope"/],
    ["a knob the lens does not declare", () => mount(world(), { ...BIND, tempo: { knob: "dance_fpz" } }), /bind "tempo": no tunable "dance_fpz"/],
    ["a slider on a bool knob", () => mount(world(), { ...BIND, tempo: { knob: "sound" } }), /bind "tempo": a slider binds a float or int knob, not "sound" \(bool\)/],
    ["a toggle on an enum knob", () => mount(world(), { ...BIND, sound: { knob: "source" } }), /bind "sound": a toggle binds a bool knob, not "source" \(enum\)/],
    ["a cycle state that is not an option", () => mount(world(), { ...BIND, eye: { knob: "source" } }), /bind "eye": state "auto" is not an option of "source"/],
    ["a slider range outside the knob's", () => mount(world(dash(), flyCtl({ tempo: slider("tempo", 2, 30, 1) }))), /slider "tempo": 2…30 outside the knob's 4…30/],
    // S251 (deferred minor of S249): a slider finer than its int knob wrote 4.5 into an int
    ["a slider stepping finer than its int knob", () => mount(world(dash(), flyCtl({ tempo: slider("tempo", 4, 30, 0.5) }))), /slider "tempo": step 0\.5 is not a whole multiple of "dance_fps"'s step 1/],
    ["a slider starting off its int knob's grid", () => mount(world(dash(), flyCtl({ tempo: slider("tempo", 4.5, 30, 1) }))), /slider "tempo": min 4\.5 is not on "dance_fps"'s grid \(4 \+ k·1\)/],
    ["a map that is not a function", () => mount(world(), { ...BIND, fog: { knobs: ["soft_radius", "trail"], map: 3 as never, unmap: fogOf } }), /bind "fog": map is not a function/],
    ["an unmap that is not a function", () => mount(world(), { ...BIND, fog: { knobs: ["soft_radius", "trail"], map: fogMap, unmap: undefined as never, lossy: true } }), /bind "fog": unmap is not a function/],
    ["a value that is not an option", () => mount(world(), { ...BIND, "view-a": { knob: "source", value: "zz" } }), /bind "view-a": "zz" is not an option of "source"/],
    ["a number value outside the range", () => mount(world(dash({ "view-a": { kind: "toggle", id: "view-a", label: "a", icon: "<svg/>" } })), { ...BIND, "view-a": { knob: "grid", value: 9 } }), /bind "view-a": 9 is outside "grid"'s 1…3/],
    ["a states map whose ids differ from the cycle's", () => mount(world(), { ...BIND, grid: { knobs: ["grid", "grid_mode"], states: { single: GRID.single!, palettes: GRID.palettes! } } }), /bind "grid": states \(single, palettes\) differ from the cycle's \(single, palettes, readings\)/],
    ["a state that does not set exactly the knobs", () => mount(world(), { ...BIND, grid: { knobs: ["grid", "grid_mode"], states: { ...GRID, single: { grid: 1 } } } }), /bind "grid": state "single" sets \(grid\), expected \(grid, grid_mode\)/],
    ["a state value that is not an option", () => mount(world(), { ...BIND, grid: { knobs: ["grid", "grid_mode"], states: { ...GRID, single: { grid: 1, grid_mode: "tiles" } } } }), /bind "grid": "tiles" is not an option of "grid_mode"/],
    ["an unknown binding key (a typo)", () => mount(world(), { ...BIND, tempo: { knob: "dance_fps", lossy: true } as never }), /bind "tempo": unknown key "lossy"/],
    ["a thumb with no value to write", () => mount(world(), { ...BIND, "view-a": { knob: "source" } }), /bind "view-a": a thumb binds \{ knob, value \}/],
    ["a toggle whose states are not off/on", () => mount(world(dash({ sound: { kind: "toggle", id: "sound", label: "s", icon: "<svg/>", states: states("melt", "paint") } }))), /bind "sound": a bound toggle's states must be exactly off, on \(got melt, paint\)/],
    ["a map whose round trip fails, not declared lossy", () => mount(world(), { ...BIND, fog: { knobs: ["soft_radius", "trail"], map: fogMap, unmap: () => 0 } }), /bind "fog": unmap\(map\(x\)\) is not x at x = 0\.1 \(got 0\); declare lossy: true if that is intended/],
    ["a map that writes other knobs than it names", () => mount(world(), { ...BIND, fog: { knobs: ["soft_radius"], map: fogMap, unmap: fogOf, lossy: true } }), /bind "fog": map\(0\) sets \(soft_radius, trail\), expected \(soft_radius\)/],
    // final review (S249, Important 2): the flyout's controls were validated only at the first open, inside a click
    ["a malformed flyout control is refused at bind, not at the first click", () => mount(world(dash(), flyCtl({ tempo: slider("tempo", 30, 4, 1) }))), /flyout\.controls\[0\]: min 30 is not below max 4/],
    ["a flyout id colliding with a dashboard control is refused at bind", () => mount(world(dash(), [slider("sound", 0, 1, 1)])), /flyout\.controls\[0\]: duplicate id "sound"/],
    ["a map on a cycle", () => mount(world(), { ...BIND, grid: { knobs: ["grid"], map: (v) => ({ grid: v }), unmap: (v) => Number(v.grid) } }), /bind "grid": a map binds a slider, not a cycle/],
  ];
  for (const [name, f, re] of cases) test(name, () => expect(f).toThrow(re));
  test("a valid set of bindings mounts", () => expect(() => mount(world())).not.toThrow());
});

describe("bind — the write path and the reverse channel", () => {
  test("input writes the knob; the slider's value comes from the LISTENER, after the surface notified", () => {
    const w = world(dash(), FLY, ["tempo"]);
    const b = mount(w);
    w.log.length = 0;
    expect(b.input("tempo", 20)).toBe(true);
    expect(w.values.get("dance_fps")).toBe(20);
    const write = w.log.indexOf("write dance_fps=20"), notify = w.log.indexOf("notify"), set = w.log.indexOf('set tempo {"value":20}');
    expect([write >= 0, notify > write, set > notify]).toEqual([true, true, true]);
  });
  test("a console-side write moves a bound control (the reverse channel)", () => {
    const w = world(dash(), FLY, ["tempo"]);
    mount(w);
    w.surface.setTunable(["dance_fps"], 9);
    expect(lastSet(w, "tempo")).toEqual({ value: 9 });
  });
  test("the control's value is the SURFACE's, never the drag: a coercing surface; one set per notify", () => {
    // S251 (deferred minor of S249): the order test above catches a chrome.set BEFORE the write only. A set AFTER
    // setTunable returns would pass it, so here the surface coerces (even fps only) and the last set must carry the
    // coerced value, with exactly one set of the control per notification
    const w = world(dash(), FLY, ["tempo"]);
    const raw = w.surface.setTunable;
    w.surface.setTunable = (p, v) => raw(p, p[0] === "dance_fps" ? Math.round(Number(v) / 2) * 2 : v);
    const b = mount(w);
    const sets0 = w.sets.filter(([i]) => i === "tempo").length, notes0 = w.log.filter((l) => l === "notify").length;
    b.input("tempo", 21);
    b.input("tempo", 17);
    expect(w.values.get("dance_fps")).toBe(18);
    expect(lastSet(w, "tempo")).toEqual({ value: 18 });
    expect(w.sets.filter(([i]) => i === "tempo").length - sets0).toBe(w.log.filter((l) => l === "notify").length - notes0);
  });
  test("the listener runs once at bind", () => {
    const w = world(dash(), FLY, ["zoom"]);
    w.values.set("zoom", 2.5);
    mount(w);
    expect(lastSet(w, "zoom")).toEqual({ value: 2.5 });
  });
  test("a flyout control is skipped while absent and positioned by sync() once present", () => {
    const w = world();
    const b = mount(w);
    w.surface.setTunable(["dance_fps"], 22);
    expect(lastSet(w, "tempo")).toBeUndefined();
    w.ids.add("tempo");
    b.sync();
    expect(lastSet(w, "tempo")).toEqual({ value: 22 });
  });
  test("value thumbs: press writes the value; `on` follows equality for every thumb in the group", () => {
    const w = world();
    const b = mount(w);
    expect([lastSet(w, "view-a"), lastSet(w, "view-b")]).toEqual([{ on: true }, { on: false }]);
    expect(b.press("view-b")).toBe(true);
    expect(w.values.get("source")).toBe("b");
    expect([lastSet(w, "view-a"), lastSet(w, "view-b")]).toEqual([{ on: false }, { on: true }]);
  });
  test("a bool toggle: press flips the knob; on AND the off/on face follow it", () => {
    const w = world();
    const b = mount(w);
    expect(lastSet(w, "sound")).toEqual({ on: false, state: "off" });
    b.press("sound");
    expect([w.values.get("sound"), lastSet(w, "sound")]).toEqual([true, { on: true, state: "on" }]);
  });
  test("an enum cycle: press advances through ITS states; a value outside them reads '<label>: custom'", () => {
    const w = world();
    const b = mount(w);
    expect(lastSet(w, "eye")).toEqual({ state: "auto" });
    b.press("eye");
    expect([w.values.get("ui_mode"), lastSet(w, "eye")]).toEqual(["always_on", { state: "always_on" }]);
    w.surface.setTunable(["ui_mode"], "always_on+labels");   // an option the cycle does not show
    expect(lastSet(w, "eye")).toEqual({ label: "eye: custom" });
    b.press("eye");                                         // from outside the states: the first state
    expect(w.values.get("ui_mode")).toBe("auto");
  });
  test("a states cycle: press advances and writes ALL its knobs; the state follows; no match reads '<label>: custom'", () => {
    const w = world();
    const b = mount(w);
    expect(lastSet(w, "grid")).toEqual({ state: "single" });
    b.press("grid");
    expect([w.values.get("grid"), w.values.get("grid_mode"), lastSet(w, "grid")]).toEqual([3, "hue", { state: "palettes" }]);
    b.press("grid");
    expect([w.values.get("grid"), w.values.get("grid_mode"), lastSet(w, "grid")]).toEqual([3, "readings", { state: "readings" }]);
    w.surface.setTunable(["grid"], 2);                      // a world may sit at grid 2
    expect(lastSet(w, "grid")).toEqual({ label: "grid: custom" });
    b.press("grid");
    expect([w.values.get("grid"), w.values.get("grid_mode")]).toEqual([1, "views"]);
  });
  test("a map slider: input writes every mapped knob; unmap positions it", () => {
    const w = world(dash(), FLY, ["fog"]);
    const b = mount(w);
    expect(lastSet(w, "fog")).toEqual({ value: 0 });
    b.input("fog", 0.6);
    expect([w.values.get("soft_radius"), w.values.get("trail"), lastSet(w, "fog")]).toEqual([3, 0.7, { value: 0.6 }]);
  });
  test("lossy declared ⇒ no round-trip check at mount", () => {
    expect(() => mount(world(), { ...BIND, fog: { knobs: ["soft_radius", "trail"], map: fogMap, unmap: () => 0, lossy: true } })).not.toThrow();
  });
  test("an unbound id returns false, so the lens's own handler runs", () => {
    const b = mount(world());
    expect([b.press("restart"), b.input("other", 1)]).toEqual([false, false]);
  });
  test("destroy() unsubscribes", () => {
    const w = world(dash(), FLY, ["tempo"]);
    const b = mount(w);
    b.destroy();
    const n = w.sets.length;
    w.surface.setTunable(["dance_fps"], 5);
    expect(w.sets.length).toBe(n);
    expect(w.listeners.size).toBe(0);
  });
  test("a write the surface refuses propagates out of input and press (never swallowed)", () => {
    const d = dash({ "view-a": { kind: "toggle", id: "view-a", label: "a", icon: "<svg/>" } });
    const w = world(d, [slider("tempo", 4, 30, 1)], ["tempo"]);
    const b = bind(w.chrome, w.d, TUNABLES, w.surface, { tempo: { knob: "flaky" }, "view-a": { knob: "flaky", value: 3 } }, w.fly);
    expect(() => b.input("tempo", 5)).toThrow(/flaky: refused/);
    expect(() => b.press("view-a")).toThrow(/flaky: refused/);
  });
});
