import type { LensTunable, TunableValue } from "@/lenses/types";

/* The whole-world config round-trip, as pure functions over a tunable manifest.
 *
 * ★ WHY THIS EXISTS AT ALL. A surface carrying knobs that cannot dump and reload its
 * whole configuration turns every sighting into an anecdote: you find something worth
 * keeping, and the only record is a screenshot that is missing three fields. This is
 * the sandbox's JSON textarea, promoted to the chrome so every substrate has it
 * without writing a line.
 *
 * ★ AND IT IS NOT A SECOND WRITE PATH. `apply` returns a list of (id, value) pairs for
 * the caller to push through the SAME `setTunable` a slider uses, so clamping,
 * membership refusal and change notification all behave identically. A loader that
 * wrote `history.config` directly would be the exact defect S198 found in the rail.
 *
 * ⚠ A DUMP IS A WORLD, NOT A TRAJECTORY. It rebuilds the configuration you are in. It
 * will not replay a run that was live-tweaked for fifteen thousand ticks, because the
 * path taken is not in the config. The panel says so; so does this comment, because
 * the two are equally likely to be read. (Since spec/31 the HISTORY holds that path:
 * every config change is recorded on its tick and replayed in place. The dump still
 * carries only the world.)
 */

export type ConfigDump = {
  substrate: string;
  lens: string;
  puzzle?: string | undefined;
  tunables: Record<string, TunableValue>;
};

export function buildDump(
  meta: { substrate: string; lens: string; puzzle?: string | undefined },
  tunables: readonly LensTunable[],
  read: (t: LensTunable) => TunableValue | undefined,
): ConfigDump {
  const out: Record<string, TunableValue> = {};
  for (const t of tunables) {
    const v = read(t);
    // ⚠ an id whose value is unreadable is OMITTED, not written as null. A null would
    // round-trip back through `setTunable` as a refusal or a coerce, and a dump that
    // cannot be reloaded is worse than one that admits a hole.
    if (v !== undefined) out[t.id] = v;
  }
  return { ...meta, tunables: out };
}

export type ApplyPlan = {
  writes: { id: string; value: TunableValue; path: string[] }[];
  /** Refusals, each naming what was wrong. Never a silent drop. */
  problems: string[];
  /** Set when the payload is for a different substrate/lens — the caller should
   *  refuse the whole apply rather than write a partial world. */
  mismatch: string | null;
};

/**
 * Turn a pasted payload into a set of writes, or into reasons it cannot be one.
 *
 * ⚠ THE MISMATCH IS A WHOLE-PAYLOAD REFUSAL, NOT A PER-KEY ONE. Pasting marea's world
 * into wacha would otherwise apply whichever ids happen to share a name and leave the
 * rest, producing a world that belongs to neither and that nothing can reproduce.
 * A partial apply is the failure mode a round-trip exists to prevent.
 */
export function planApply(
  raw: unknown,
  meta: { substrate: string; lens: string },
  tunables: readonly LensTunable[],
): ApplyPlan {
  const plan: ApplyPlan = { writes: [], problems: [], mismatch: null };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    plan.mismatch = "not a config object";
    return plan;
  }
  const obj = raw as Partial<ConfigDump>;
  if (typeof obj.substrate === "string" && obj.substrate !== meta.substrate) {
    plan.mismatch = `this config is for "${obj.substrate}", not "${meta.substrate}"`;
    return plan;
  }
  if (typeof obj.lens === "string" && obj.lens !== meta.lens) {
    plan.mismatch = `this config is for lens "${obj.lens}", not "${meta.lens}"`;
    return plan;
  }
  const values = obj.tunables;
  if (typeof values !== "object" || values === null) {
    plan.mismatch = "no `tunables` object in the payload";
    return plan;
  }

  const byId = new Map(tunables.map((t) => [t.id, t]));
  for (const [id, value] of Object.entries(values)) {
    const t = byId.get(id);
    // ⚠ AN UNKNOWN KEY IS REPORTED, NOT IGNORED. Validating each value's RANGE is not
    // validating the SET of keys: a renamed knob would otherwise vanish from every
    // pasted world in silence, which is how a config drifts away from its substrate.
    if (!t) { plan.problems.push(`unknown knob "${id}" — ignored`); continue; }
    if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") {
      plan.problems.push(`"${id}": ${typeof value} is not a tunable value`);
      continue;
    }
    plan.writes.push({ id, value, path: t.path });
  }
  return plan;
}
