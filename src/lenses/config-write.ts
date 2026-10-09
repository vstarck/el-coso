/* CONFIG-TARGET WRITES, CHECKED (S263) — the one check every route that writes a `target: "config"` tunable takes:
 * the embed's mount-time `tunables`, the app's Rules rail (a knob and a pasted config) and a lens's own setter.
 *
 * ★ Before S263 there were three routes and one guard. `mountSubstrate` deep-set a value into the parsed level with no
 * type, range or integer check and CREATED any object missing on the way (rgba: mobility 5 at mount → 54,484
 * non-finite cells by tick 200); the Rules rail wrote through `historyEditConfig`, which checks only that the parent
 * exists; and only rgba's lens setter checked anything, so the guard sat on the one route the app does not take.
 *
 * Two tiers. The DECLARATION (type, finite, whole for an int, inside min…max, an option of an enum, and a path that
 * already exists in this level — a write never fabricates an object) is checked here for every substrate. What no
 * single knob can state — rgba's stability bound ties three knobs and the live wetness together — is the substrate's
 * `checkConfig`, run once on the config as it would be after ALL the writes, so a batch is judged by where it lands and
 * not by the order it was written in. Nothing is written unless every write passes: a refused batch leaves the config
 * as it was (a partial apply is the failure a pasted config exists to prevent). */
import type { LensTunable, TunableValue } from "./types";

/** A substrate's whole-config invariants: throws, naming the violation, or returns. Never repairs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a substrate's checker takes ITS config type
export type ConfigCheck = (config: any) => void;
export type ConfigWrite = { tunable: LensTunable; value: unknown };

/** The declaration's half: the value alone against its knob. */
export function checkTunableValue(t: LensTunable, value: unknown): asserts value is TunableValue {
  const at = t.id;
  if (t.type === "bool") {
    if (typeof value !== "boolean") throw new Error(`${at} takes true or false, got ${String(value)}`);
    return;
  }
  if (t.type === "enum") {
    if (typeof value !== "string" || !t.options.includes(value)) throw new Error(`${at} must be one of ${t.options.join(", ")}, got ${String(value)}`);
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${at} needs a finite number, got ${String(value)}`);
  if (t.type === "int" && !Number.isInteger(value)) throw new Error(`${at} must be a whole number, got ${value}`);
  if (value < t.min || value > t.max) throw new Error(`${at} = ${value} is outside ${t.min}…${t.max}`);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Copy only the objects on `path`, sharing everything else (a level can carry megabytes of planes; a slider drag must
 *  not clone them), and set the leaf. The leaf must already exist: a write never creates a key. */
function withLeaf(config: unknown, t: LensTunable, value: TunableValue): unknown {
  if (t.target !== "config") throw new Error(`${t.id} is a ${t.target} tunable, not a config one`);
  if (t.path.length === 0) throw new Error(`${t.id} has an empty path`);
  const copy = (o: Record<string, unknown>) => (Array.isArray(o) ? [...o] : { ...o }) as Record<string, unknown>;
  if (!isObj(config)) throw new Error(`${t.id}: the config is not an object`);
  const root = copy(config);
  let cur = root;
  for (let i = 0; i < t.path.length; i++) {
    const k = t.path[i]!;
    if (!Object.prototype.hasOwnProperty.call(cur, k)) throw new Error(`${t.id}: this level has no ${t.path.slice(0, i + 1).join(".")}`);
    if (i === t.path.length - 1) { cur[k] = value; break; }
    const next = cur[k];
    if (!isObj(next) || ArrayBuffer.isView(next)) throw new Error(`${t.id}: ${t.path.slice(0, i + 1).join(".")} is not an object`);
    cur = cur[k] = copy(next);
  }
  return root;
}

/** Judge a batch of writes against `config` without touching it: every value against its declaration, every path
 *  against this level, then `checkConfig` once on where the batch lands. Throws on the first violation, naming it;
 *  else returns that landing config (objects on the written paths copied, the rest shared with `config`).
 *
 *  ⚠ A HOOK THAT RETURNS SOMETHING IS REFUSED. The hook is found by its export NAME, and a package can already carry a
 *  checker of that name with another contract — rele's returns the refusal as a string — which would otherwise be
 *  called, ignored, and read as a pass. */
export function checkConfigWrites<C>(config: C, writes: readonly ConfigWrite[], checkConfig?: ConfigCheck): C {
  let candidate: unknown = config;
  for (const w of writes) {
    checkTunableValue(w.tunable, w.value);
    candidate = withLeaf(candidate, w.tunable, w.value);
  }
  if (writes.length > 0 && checkConfig) {
    const out = (checkConfig as (c: unknown) => unknown)(candidate);
    if (out !== undefined) throw new Error(`checkConfig must throw or return nothing; it returned ${JSON.stringify(out)}`);
  }
  return candidate as C;
}

/** The embed's mount-time `tunables` (spec/25), split and checked BEFORE the history is built: config-target values
 *  land in the level as ONE batch through `checkConfigWrites` (baked into the run, as before), lens-target ones are
 *  returned for the mounted lens's own setter. A dotted key that names no tunable of this lens is refused — it used to
 *  fall through to the lens's `setTunable`, which several lenses implement as a no-op. Pure, so node can gate it. */
export function planMountTunables<C>(
  lensId: string,
  tunables: readonly LensTunable[],
  level: C,
  values: Record<string, unknown>,
  checkConfig?: ConfigCheck,
): { level: C; lens: Array<{ path: string[]; value: TunableValue }> } {
  const configWrites: ConfigWrite[] = [];
  const lens: Array<{ path: string[]; value: TunableValue }> = [];
  for (const [dotted, value] of Object.entries(values)) {
    const t = tunables.find((d) => d.path.join(".") === dotted);
    if (!t) throw new Error(`mount: lens "${lensId}" has no tunable "${dotted}" (declared: ${tunables.map((d) => d.path.join(".")).join(", ")})`);
    if (t.target === "config") configWrites.push({ tunable: t, value });
    else lens.push({ path: [...t.path], value: value as TunableValue });
  }
  return { level: checkConfigWrites(level, configWrites, checkConfig), lens };
}
