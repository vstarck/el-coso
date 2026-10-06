/* BINDINGS (spec/32 §5.2; S249, wacha's post its first reader): a control tied to a tunable through the lens's OWN
 * tunable surface — `setTunable` to write, `subscribeTunables` + `getTunable` to show. The chrome holds no copy of a
 * knob (spec/32 §2.3): a control's state is set ONLY by the listener, after the funnel has notified, so the console,
 * a labs form and the chrome cannot disagree about a value.
 *
 * ★ EVERY BINDING IS CHECKED AT MOUNT against the dashboard and the lens's declared tunables: an id no control has, a
 * knob the lens lacks, a kind that cannot carry the knob's type, a slider wider than its knob or off an int knob's
 * grid, a value outside an enum, a cycle whose states are not the knob's options, a map or unmap that is no function. A binding that would do nothing is refused, never mounted. */
import type { LensTunable, TunableValue } from "@/lenses/types";
import type { Chrome, ControlPatch } from "./chrome";
import { controlIds, validateControls, type Control, type Dashboard } from "./decl";

export type TunableSurfaceLike = {
  getTunable(path: string[]): TunableValue | undefined;
  setTunable(path: string[], value: TunableValue): void;
  subscribeTunables(listener: () => void): () => void;
};
export type Binding =
  /** slider ↔ float/int knob · toggle ↔ bool knob · cycle ↔ enum knob (its states a subset of the options) */
  | { knob: string }
  /** a thumb or toggle that WRITES one value; `on` while the knob equals it */
  | { knob: string; value: TunableValue }
  /** a cycle over several knobs: each state is one assignment of all of them (wacha's grid) */
  | { knobs: string[]; states: Record<string, Record<string, TunableValue>> }
  /** a slider over several knobs through a pure mapping; `unmap` positions it. Not `lossy` ⇒ the round trip is
   *  checked at mount over 11 points of the slider's range. */
  | { knobs: string[]; map: (v: number) => Record<string, TunableValue>; unmap: (vals: Record<string, TunableValue>) => number; lossy?: true };
export type Bound = {
  /** true when the id is bound (the write happened); false hands it to the caller's own handler */
  press(id: string): boolean;
  input(id: string, v: number): boolean;
  /** re-run the reverse channel — after a flyout opens, its controls exist and need positioning */
  sync(): void;
  destroy(): void;
};

const BINDING_KEYS = [["knob"], ["knob", "value"], ["knobs", "states"], ["knobs", "map", "unmap", "lossy"]] as const;
/** the faces a bound toggle may declare: its state follows the knob, so the ids must be the knob's two values */
const TOGGLE_FACES = ["off", "on"];

class BindError extends Error {
  constructor(id: string | null, reason: string) { super(`bind${id === null ? "" : ` "${id}"`}: ${reason}`); }
}
const list = (xs: readonly string[]) => [...xs].sort().join(", ");

function checkValue(id: string, t: LensTunable, v: TunableValue): void {
  if (t.type === "enum") { if (typeof v !== "string" || !t.options.includes(v)) throw new BindError(id, `"${String(v)}" is not an option of "${t.id}"`); return; }
  if (t.type === "bool") { if (typeof v !== "boolean") throw new BindError(id, `${String(v)} is not a boolean for "${t.id}"`); return; }
  if (typeof v !== "number" || !(v >= t.min && v <= t.max)) throw new BindError(id, `${String(v)} is outside "${t.id}"'s ${t.min}…${t.max}`);
}

export function bind(
  chrome: Chrome, dashboard: Dashboard, tunables: readonly LensTunable[], surface: TunableSurfaceLike,
  bindings: Record<string, Binding>, flyoutControls: readonly Control[] = [],
): Bound {
  // ⚠ the flyout's controls get the dashboard's refusals HERE, at mount (final review S249): validated only by
  // `openFlyout`, a malformed one surfaced as an uncaught error at the first click, and an id colliding with a
  // dashboard control silently replaced it in the map below
  validateControls(flyoutControls, "flyout", new Set(controlIds(dashboard)));
  const controls = new Map<string, Control>();
  for (const s of Object.values(dashboard.slots)) for (const c of s!.controls) controls.set(c.id, c);
  for (const c of flyoutControls) controls.set(c.id, c);
  const knobs = new Map(tunables.map((t) => [t.id, t]));
  const knob = (id: string, k: string): LensTunable => {
    const t = knobs.get(k);
    if (!t) throw new BindError(id, `no tunable "${k}"`);
    return t;
  };

  // --- refusals, before anything is subscribed
  for (const [id, b] of Object.entries(bindings)) {
    const c = controls.get(id);
    if (!c) throw new BindError(null, `no control "${id}" (declared: ${[...controls.keys()].join(", ")})`);
    const keys = Object.keys(b);
    const allowed: readonly string[] = "knobs" in b ? ("states" in b ? BINDING_KEYS[2] : BINDING_KEYS[3]) : ("value" in b ? BINDING_KEYS[1] : BINDING_KEYS[0]);
    for (const k of keys) if (!allowed.includes(k)) throw new BindError(id, `unknown key "${k}" (allowed: ${allowed.join(", ")})`);
    if ("knobs" in b) {
      if (!Array.isArray(b.knobs) || b.knobs.length === 0) throw new BindError(id, "knobs: not a non-empty array");
      const ts = b.knobs.map((k) => knob(id, k));
      if ("states" in b) {
        if (c.kind !== "cycle") throw new BindError(id, `a states map binds a cycle, not a ${c.kind}`);
        const want = c.states.map((s) => s.id), got = Object.keys(b.states);
        if (list(want) !== list(got)) throw new BindError(id, `states (${got.join(", ")}) differ from the cycle's (${want.join(", ")})`);
        for (const [sid, vals] of Object.entries(b.states)) {
          if (list(Object.keys(vals)) !== list(b.knobs)) throw new BindError(id, `state "${sid}" sets (${list(Object.keys(vals))}), expected (${list(b.knobs)})`);
          ts.forEach((t) => checkValue(id, t, vals[t.id]!));
        }
      } else {
        if (c.kind !== "slider") throw new BindError(id, `a map binds a slider, not a ${c.kind}`);
        // S251: checked before the first call, or a non-function threw a bare TypeError from inside the check below
        for (const f of ["map", "unmap"] as const) if (typeof b[f] !== "function") throw new BindError(id, `${f} is not a function`);
        const at0 = Object.keys(b.map(c.min));
        if (list(at0) !== list(b.knobs)) throw new BindError(id, `map(${c.min}) sets (${list(at0)}), expected (${list(b.knobs)})`);
        for (let i = 0; i <= 10; i++) {
          const x = c.min + (i * (c.max - c.min)) / 10;
          const vals = b.map(x);
          ts.forEach((t) => checkValue(id, t, vals[t.id]!));
          if (b.lossy !== true) {
            const back = b.unmap(vals);
            if (!(Math.abs(back - x) <= 1e-6 * (c.max - c.min))) {
              throw new BindError(id, `unmap(map(x)) is not x at x = ${Number(x.toPrecision(6))} (got ${back}); declare lossy: true if that is intended`);
            }
          }
        }
      }
      continue;
    }
    const t = knob(id, b.knob);
    if ("value" in b) {
      if (c.kind !== "thumb" && c.kind !== "toggle") throw new BindError(id, `a value binds a thumb or a toggle (it shows "on"), not a ${c.kind}`);
      checkValue(id, t, b.value);
      continue;
    }
    if (c.kind === "slider") {
      if (t.type !== "float" && t.type !== "int") throw new BindError(id, `a slider binds a float or int knob, not "${t.id}" (${t.type})`);
      if (c.min < t.min || c.max > t.max) throw new BindError(null, `slider "${id}": ${c.min}…${c.max} outside the knob's ${t.min}…${t.max}`);
      // S251: an int knob takes only its own grid — a finer slider wrote 4.5 into an int
      if (t.type === "int") {
        const whole = (x: number) => Math.abs(x - Math.round(x)) <= 1e-9;
        if (!whole(c.step / t.step)) throw new BindError(null, `slider "${id}": step ${c.step} is not a whole multiple of "${t.id}"'s step ${t.step}`);
        if (!whole((c.min - t.min) / t.step)) throw new BindError(null, `slider "${id}": min ${c.min} is not on "${t.id}"'s grid (${t.min} + k·${t.step})`);
      }
    } else if (c.kind === "toggle") {
      if (t.type !== "bool") throw new BindError(id, `a toggle binds a bool knob, not "${t.id}" (${t.type})`);
      if (c.states && list(c.states.map((s) => s.id)) !== list(TOGGLE_FACES)) {
        throw new BindError(id, `a bound toggle's states must be exactly ${TOGGLE_FACES.join(", ")} (got ${c.states.map((s) => s.id).join(", ")})`);
      }
    } else if (c.kind === "cycle") {
      if (t.type !== "enum") throw new BindError(id, `a cycle binds an enum knob, not "${t.id}" (${t.type})`);
      for (const s of c.states) if (!t.options.includes(s.id)) throw new BindError(id, `state "${s.id}" is not an option of "${t.id}"`);
    } else {
      throw new BindError(id, `a ${c.kind} binds { knob, value }`);
    }
  }

  // --- the reverse channel: the ONLY place a bound control's state is set
  const get = (k: string) => surface.getTunable([k]);
  const values = (ks: readonly string[]) => Object.fromEntries(ks.map((k) => [k, get(k)!]));
  const sync = () => {
    for (const [id, b] of Object.entries(bindings)) {
      if (!chrome.has(id)) continue;                      // a flyout control while its flyout is shut
      const c = controls.get(id)!;
      let patch: ControlPatch;
      if ("knobs" in b) {
        if ("states" in b) {
          const v = values(b.knobs);
          const hit = Object.entries(b.states).find(([, vals]) => b.knobs.every((k) => vals[k] === v[k]));
          patch = hit ? { state: hit[0] } : { label: `${c.label}: custom` };
        } else patch = { value: b.unmap(values(b.knobs)) };
      } else if ("value" in b) patch = { on: get(b.knob) === b.value };
      else if (c.kind === "slider") patch = { value: Number(get(b.knob)) };
      else if (c.kind === "toggle") {
        const on = get(b.knob) === true;
        patch = c.states ? { on, state: on ? "on" : "off" } : { on };
      } else {
        const v = String(get(b.knob));
        patch = c.kind === "cycle" && c.states.some((s) => s.id === v) ? { state: v } : { label: `${c.label}: custom` };
      }
      chrome.set(id, patch);
    }
  };
  const unsubscribe = surface.subscribeTunables(sync);
  sync();

  // --- writes: through the surface only; never chrome.set here
  const write = (k: string, v: TunableValue) => surface.setTunable([k], v);
  return {
    press(id) {
      const b = bindings[id];
      if (!b) return false;
      const c = controls.get(id)!;
      if ("knobs" in b) {
        if (!("states" in b)) throw new BindError(id, "a slider has no press");
        const ids = (c as Extract<Control, { kind: "cycle" }>).states.map((s) => s.id);
        const v = values(b.knobs);
        const i = ids.findIndex((sid) => b.knobs.every((k) => b.states[sid]![k] === v[k]));
        const next = b.states[ids[(i + 1) % ids.length]!]!;   // from "custom" (i = −1): the first state
        for (const k of b.knobs) write(k, next[k]!);
        return true;
      }
      if ("value" in b) { write(b.knob, b.value); return true; }
      if (c.kind === "toggle") { write(b.knob, get(b.knob) !== true); return true; }
      if (c.kind === "cycle") {
        const ids = c.states.map((s) => s.id);
        write(b.knob, ids[(ids.indexOf(String(get(b.knob))) + 1) % ids.length]!);
        return true;
      }
      throw new BindError(id, `a ${c.kind} has no press`);
    },
    input(id, v) {
      const b = bindings[id];
      if (!b) return false;
      if ("knobs" in b && "map" in b) { const vals = b.map(v); for (const k of b.knobs) write(k, vals[k]!); return true; }
      if (!("knobs" in b) && !("value" in b) && controls.get(id)!.kind === "slider") { write(b.knob, v); return true; }
      throw new BindError(id, "only a slider has input");
    },
    sync,
    destroy: unsubscribe,
  };
}
