/* The dashboard DECLARATION (spec/32 §5.1, §6; S248). Data, validated: one key schema per level, and every level's
 * refusal is derived from its own schema (CLAUDE.md §I — "the refusal must follow the keys down"). The type and the
 * key lists are TWO lists, so the compile-time check under CONTROL_KEYS makes them agree in both directions.
 * ★ THE STRUCTURE IS OPEN, THE VOCABULARY IS BUILT ON DEMAND: a control kind exists once a consumer uses it. */
import type { Qr, Source } from "./footer";

export const SLOTS = ["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type Slot = (typeof SLOTS)[number];
export const UI_MODES = ["auto", "always_on", "always_on+labels"] as const;
export type UiMode = (typeof UI_MODES)[number];
/** the slots a vignette is DRAWN for (CSS exists); declaring one elsewhere is refused, not ignored */
export const VIGNETTE_SLOTS: readonly Slot[] = ["left", "right", "bottom"];

export type CycleState = { id: string; icon: string; label: string };
type Common = { id: string; label: string; hidden?: boolean; disabled?: boolean };
/** ⚠ a custom control has no `disabled`: the chrome cannot disable an element the substrate built (S248 review I3) */
type CustomCommon = Omit<Common, "disabled">;
export type ButtonControl = Common & { kind: "button"; icon: string; big?: boolean };
/** `states` (optional): the toggle's FACE — icon + label — switched by `set(id, { state })` independently of on/off
 *  (swarm-swart-grid's brush: one toggle whose tool, melt or paint, follows the view; S248). */
export type ToggleControl = Common & { kind: "toggle"; icon: string; states?: CycleState[] };
export type CycleControl = Common & { kind: "cycle"; states: CycleState[]; big?: boolean };
export type ThumbControl = Common & { kind: "thumb" };
export type CustomControl = CustomCommon & { kind: "custom"; mount: (el: HTMLElement) => () => void };
/** A range control (S249, wacha's tune flyout). It reports `input` events; its value is set only by the substrate
 *  (`set(id, { value })`), so it never holds a second copy of a knob (spec/32 §2.3). */
export type SliderControl = Common & { kind: "slider"; min: number; max: number; step: number };
export type Control = ButtonControl | ToggleControl | CycleControl | ThumbControl | CustomControl | SliderControl;
type Kind = Control["kind"];

export type SlotDecl = { controls: Control[]; direction?: "row" | "column"; vignette?: boolean };
export type Footer = { sources: Source[]; qr: Qr; caption: string };
export type Dashboard = {
  slots: Partial<Record<Slot, SlotDecl>>;
  behaviour: { idleSeconds: number };
  theme: { accent?: string };
  footer: Footer | null;
};
export type DashboardPatch = {
  slots?: Partial<Record<Slot, SlotDecl>>;
  behaviour?: Partial<Dashboard["behaviour"]>;
  theme?: Dashboard["theme"];
  footer?: Footer;
  replace?: { controls?: Control[]; slots?: Slot[]; footer?: boolean };
  remove?: string[];
};

const COMMON = ["kind", "id", "label", "hidden", "disabled"] as const;
export const CONTROL_KEYS = {
  button: [...COMMON, "icon", "big"],
  toggle: [...COMMON, "icon", "states"],
  cycle: [...COMMON, "states", "big"],
  thumb: [...COMMON],
  custom: ["kind", "id", "label", "hidden", "mount"],
  slider: [...COMMON, "min", "max", "step"],
} as const satisfies { [K in Kind]: readonly (keyof Extract<Control, { kind: K }>)[] };
// the reverse direction: a key on the TYPE that no list carries is a compile error here
type Uncovered = { [K in Kind]: Exclude<keyof Extract<Control, { kind: K }>, (typeof CONTROL_KEYS)[K][number]> }[Kind];
const _everyTypeKeyListed: [Uncovered] extends [never] ? true : never = true;
void _everyTypeKeyListed;

const DASHBOARD_KEYS = ["slots", "behaviour", "theme", "footer"] as const;
const SLOT_KEYS = ["controls", "direction", "vignette"] as const;
const BEHAVIOUR_KEYS = ["idleSeconds"] as const;
const THEME_KEYS = ["accent"] as const;
const FOOTER_KEYS = ["sources", "qr", "caption"] as const;
const QR_KEYS = ["url", "rows"] as const;
const SOURCE_KEYS = ["mark", "tint", "title", "detail", "icon", "glyph"] as const;
const STATE_KEYS = ["id", "icon", "label"] as const;
const PATCH_KEYS = ["slots", "behaviour", "theme", "footer", "replace", "remove"] as const;
const REPLACE_KEYS = ["controls", "slots", "footer"] as const;
const ID_RE = /^[a-z0-9][a-z0-9+-]*$/;
/** the data-roles the chrome itself uses: a control with one of these ids (or prefixes) would shadow it (review I4) */
const RESERVED_IDS = ["chrome", "stage", "canvas", "footer", "flyout"];
const RESERVED_PREFIXES = ["label-", "vignette-"];
const GLYPH_KEYS = ["d", "box", "ink"] as const;

export class DashboardError extends Error {
  constructor(readonly path: string, readonly reason: string) {
    super(`dashboard${path ? " " + path : ""}: ${reason}`);
  }
}
function obj(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new DashboardError(path, "not an object");
  return v as Record<string, unknown>;
}
function keysOnly(v: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  const o = obj(v, path);
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new DashboardError(path, `unknown key "${k}" (allowed: ${allowed.join(", ")})`);
  }
  return o;
}
/** an optional boolean: absent, or exactly true/false — `"false"` is truthy and would mean the opposite (review I1) */
const bool = (v: unknown, path: string): void => {
  if (v !== undefined && typeof v !== "boolean") throw new DashboardError(path, "not a boolean");
};
const str = (v: unknown, path: string): string => {
  if (typeof v !== "string") throw new DashboardError(path, `not a string`);
  return v;
};

function validateControl(c: unknown, path: string, ids: Set<string>): void {
  const o = obj(c, path);
  const kind = o.kind as Kind;
  if (!(typeof kind === "string" && Object.hasOwn(CONTROL_KEYS, kind))) throw new DashboardError(path, `unknown kind "${String(o.kind)}" (known: ${Object.keys(CONTROL_KEYS).join(", ")})`);
  keysOnly(o, CONTROL_KEYS[kind], path);
  const id = str(o.id, `${path}.id`);
  if (!ID_RE.test(id)) throw new DashboardError(path, `id "${id}" must match ${ID_RE} (it becomes a data-role)`);
  if (RESERVED_IDS.includes(id) || RESERVED_PREFIXES.some((x) => id.startsWith(x))) throw new DashboardError(path, `id "${id}" is reserved by the chrome`);
  if (ids.has(id)) throw new DashboardError(path, `duplicate id "${id}"`);
  ids.add(id);
  str(o.label, `${path}.label`);
  for (const k of ["hidden", "disabled", "big"]) bool(o[k], `${path}.${k}`);
  if (kind === "button" || kind === "toggle") str(o.icon, `${path}.icon`);
  if (kind === "custom" && typeof o.mount !== "function") throw new DashboardError(`${path}.mount`, "not a function");
  if (kind === "toggle" && o.states !== undefined && (!Array.isArray(o.states) || o.states.length === 0)) {
    throw new DashboardError(path, "a toggle's states, when given, need at least one");
  }
  if (kind === "cycle" && (!Array.isArray(o.states) || o.states.length === 0)) throw new DashboardError(path, "a cycle needs at least one state");
  if (kind === "slider") {
    for (const k of ["min", "max", "step"] as const) {
      if (typeof o[k] !== "number" || !Number.isFinite(o[k])) throw new DashboardError(`${path}.${k}`, "not a finite number");
    }
    if (!((o.step as number) > 0)) throw new DashboardError(`${path}.step`, "not a positive number");
    if (!((o.min as number) < (o.max as number))) throw new DashboardError(path, `min ${String(o.min)} is not below max ${String(o.max)}`);
  }
  if (Array.isArray(o.states)) {
    const seen = new Set<string>();
    o.states.forEach((s, i) => {
      const sp = `${path}.states[${i}]`;
      const so = keysOnly(s, STATE_KEYS, sp);
      const sid = str(so.id, `${sp}.id`);
      if (seen.has(sid)) throw new DashboardError(sp, `duplicate state "${sid}"`);
      seen.add(sid);
      str(so.icon, `${sp}.icon`);
      str(so.label, `${sp}.label`);
    });
  }
}

export function validateDashboard(d: Dashboard): Dashboard {
  const o = keysOnly(d, DASHBOARD_KEYS, "");
  const slots = keysOnly(o.slots, SLOTS, "slots");
  const ids = new Set<string>();
  for (const slot of SLOTS) {
    if (!(slot in slots)) continue;
    const p = `slots.${slot}`;
    const s = keysOnly(slots[slot], SLOT_KEYS, p);
    if (!Array.isArray(s.controls)) throw new DashboardError(`${p}.controls`, "not an array");
    if (s.direction !== undefined && s.direction !== "row" && s.direction !== "column") throw new DashboardError(`${p}.direction`, `"${String(s.direction)}" is not row|column`);
    bool(s.vignette, `${p}.vignette`);
    if (s.vignette === true && !VIGNETTE_SLOTS.includes(slot)) throw new DashboardError(p, `no vignette is defined for "${slot}" (only ${VIGNETTE_SLOTS.join(", ")})`);
    s.controls.forEach((c, i) => {
      validateControl(c, `${p}.controls[${i}]`, ids);
      // ⚠ S251: a slot slider had no reader — its cell carried two labels and its layout was never exercised. Lift
      // this with the first consumer that needs one, and its layout row in dev/surface-chrome-smoke
      if ((c as Control).kind === "slider") throw new DashboardError(`${p}.controls[${i}]`, "a slider lives in a controls flyout, not a slot");
    });
  }
  const b = keysOnly(o.behaviour, BEHAVIOUR_KEYS, "behaviour");
  const idle = b.idleSeconds;
  if (typeof idle !== "number" || !(idle >= 1 && idle <= 30)) throw new DashboardError("behaviour.idleSeconds", `${String(idle)} is outside 1…30`);
  const t = keysOnly(o.theme, THEME_KEYS, "theme");
  if (t.accent !== undefined && !(typeof t.accent === "string" && /^#[0-9a-f]{6}$/i.test(t.accent))) throw new DashboardError("theme.accent", `"${String(t.accent)}" is not #rrggbb`);
  if (o.footer !== null) {
    const f = keysOnly(o.footer, FOOTER_KEYS, "footer");
    if (f.qr === null || f.qr === undefined) throw new DashboardError("footer.qr", "a footer without a QR has no consumer yet (spec/32 §5.1: built on demand)");
    const q = keysOnly(f.qr, QR_KEYS, "footer.qr");
    str(q.url, "footer.qr.url");
    const rows = q.rows as unknown;
    if (!Array.isArray(rows) || rows.length < 21 || !rows.every((r) => typeof r === "string" && r.length === rows.length && /^[01]+$/.test(r))) {
      throw new DashboardError("footer.qr.rows", "not a square matrix of 0/1 rows, at least 21²");
    }
    str(f.caption, "footer.caption");
    if (!Array.isArray(f.sources)) throw new DashboardError("footer.sources", "not an array");
    f.sources.forEach((s, i) => {
      const so = keysOnly(s, SOURCE_KEYS, `footer.sources[${i}]`);
      for (const k of ["mark", "tint", "title", "detail"] as const) str(so[k], `footer.sources[${i}].${k}`);
      // ⚠ the icon and the glyph are walked too (review I1): a bad icon threw only at drawImage, and a glyph with a
      // typo'd key drew nothing (a NaN scale)
      if (so.icon !== undefined && (so.icon === null || typeof so.icon !== "object")) throw new DashboardError(`footer.sources[${i}].icon`, "not an image");
      if (so.glyph !== undefined) {
        const g = keysOnly(so.glyph, GLYPH_KEYS, `footer.sources[${i}].glyph`);
        str(g.d, `footer.sources[${i}].glyph.d`);
        str(g.ink, `footer.sources[${i}].glyph.ink`);
        if (typeof g.box !== "number" || !(g.box > 0)) throw new DashboardError(`footer.sources[${i}].glyph.box`, "not a positive number");
      }
    });
  }
  return d;
}

/** Controls that live OUTSIDE the slots (a `controls` flyout's body) get the same per-control refusals, and an id
 *  already taken by the dashboard is a duplicate (S249: the flyout's controls share the chrome's id space). */
export function validateControls(controls: unknown, path: string, taken: ReadonlySet<string>): Control[] {
  if (!Array.isArray(controls)) throw new DashboardError(`${path}.controls`, "not an array");
  const ids = new Set(taken);
  controls.forEach((c, i) => validateControl(c, `${path}.controls[${i}]`, ids));
  return controls as Control[];
}

const FLYOUT_PICK_KEYS = ["title", "items", "onPick"] as const;
const FLYOUT_CONTROLS_KEYS = ["title", "controls"] as const;
const FLYOUT_ITEM_KEYS = ["id", "label", "title", "thumb", "active"] as const;
/** A flyout body, refused on its own keys at every level like the dashboard (S251): a typo'd `onpick` or an item's
 *  `tittle` was silently ignored. `taken`: the ids the dashboard holds, for a controls body. */
export function validateFlyout(f: unknown, taken: ReadonlySet<string>): void {
  const o = obj(f, "flyout");
  if ("controls" in o) {
    keysOnly(o, FLYOUT_CONTROLS_KEYS, "flyout");
    str(o.title, "flyout.title");
    validateControls(o.controls, "flyout", taken);
    return;
  }
  keysOnly(o, FLYOUT_PICK_KEYS, "flyout");
  str(o.title, "flyout.title");
  if (typeof o.onPick !== "function") throw new DashboardError("flyout.onPick", "not a function");
  if (!Array.isArray(o.items)) throw new DashboardError("flyout.items", "not an array");
  const seen = new Set<string>();
  o.items.forEach((it, i) => {
    const p = `flyout.items[${i}]`;
    const io = keysOnly(it, FLYOUT_ITEM_KEYS, p);
    const id = str(io.id, `${p}.id`);
    if (seen.has(id)) throw new DashboardError(p, `duplicate id "${id}"`);
    seen.add(id);
    str(io.label, `${p}.label`);
    if (io.title !== undefined) str(io.title, `${p}.title`);
    if (typeof io.active !== "boolean") throw new DashboardError(`${p}.active`, "not a boolean");
  });
}

export function controlIds(d: Dashboard): string[] {
  return SLOTS.flatMap((s) => d.slots[s]?.controls.map((c) => c.id) ?? []);
}

/** A substrate's dashboard = the default plus its own. Adding is free; REPLACING an id, a slot's settings or the
 *  footer must be said (`replace`), never happen by a collision (spec/32 §6). The base is never mutated. */
export function extend(base: Dashboard, patch: DashboardPatch): Dashboard {
  keysOnly(patch, PATCH_KEYS, "patch");
  // ⚠ every level of the PATCH is refused on its own keys before anything is merged: a key the merge never visits
  // (a misspelled slot, a typo inside an appended slot) would otherwise vanish silently (review C1, C2)
  if (patch.slots !== undefined) {
    const ps = keysOnly(patch.slots, SLOTS, "patch.slots");
    for (const slot of Object.keys(ps)) {
      const a = keysOnly(ps[slot], SLOT_KEYS, `patch.slots.${slot}`);
      if (!Array.isArray(a.controls)) throw new DashboardError(`patch.slots.${slot}.controls`, "not an array");
    }
  }
  if (patch.remove !== undefined && !Array.isArray(patch.remove)) throw new DashboardError("patch.remove", "not an array");
  if (patch.replace !== undefined) {
    const r = keysOnly(patch.replace, REPLACE_KEYS, "patch.replace");
    if (r.controls !== undefined) {
      if (!Array.isArray(r.controls)) throw new DashboardError("patch.replace.controls", "not an array");
      r.controls.forEach((c, i) => obj(c, `replace.controls[${i}]`));
    }
    if (r.footer === true && patch.footer === undefined) throw new DashboardError("replace.footer", "no footer given to replace it with");
  }
  const out: Dashboard = {
    slots: Object.fromEntries(Object.entries(base.slots).map(([k, s]) => [k, { ...s!, controls: [...s!.controls] }])),
    behaviour: { ...base.behaviour, ...patch.behaviour },
    theme: { ...base.theme, ...patch.theme },
    footer: base.footer,
  };
  const all = () => controlIds(out);
  for (const id of patch.remove ?? []) {
    if (!all().includes(id)) throw new DashboardError("remove", `no control "${id}"`);
    for (const s of Object.values(out.slots)) s!.controls = s!.controls.filter((c) => c.id !== id);
  }
  for (const c of patch.replace?.controls ?? []) {
    if (!all().includes(c.id)) throw new DashboardError("replace.controls", `no control "${c.id}" to replace`);
    for (const s of Object.values(out.slots)) s!.controls = s!.controls.map((x) => (x.id === c.id ? c : x));
  }
  const replaceSlots = patch.replace?.slots ?? [];
  for (const slot of replaceSlots) {
    if (!patch.slots?.[slot]) throw new DashboardError("replace.slots", `"${slot}" listed but not declared in slots`);
  }
  for (const slot of SLOTS) {
    const add = patch.slots?.[slot];
    if (!add) continue;
    const have = out.slots[slot];
    // ⚠ A collision is checked for EVERY added control, a new slot's included: checking only appends to existing slots
    // let a new slot re-declare a default's id, which then failed later as a bare "duplicate id" (S248, plan defect).
    const replacing = replaceSlots.includes(slot) ? new Set(have?.controls.map((c) => c.id)) : new Set<string>();
    for (const c of add.controls) {
      if (all().includes(c.id) && !replacing.has(c.id)) throw new DashboardError(`slots.${slot}`, `id "${c.id}" already exists — use replace.controls`);
    }
    if (!have || replaceSlots.includes(slot)) { out.slots[slot] = { ...add, controls: [...add.controls] }; continue; }
    if (add.direction !== undefined || add.vignette !== undefined) throw new DashboardError(`slots.${slot}`, "already declared — use replace.slots to change its settings");
    for (const c of add.controls) have.controls.push(c);
  }
  if (patch.footer !== undefined) {
    if (out.footer !== null && patch.replace?.footer !== true) throw new DashboardError("footer", "already declared — use replace.footer");
    out.footer = patch.footer;
  }
  return validateDashboard(out);
}
