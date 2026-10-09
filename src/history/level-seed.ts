/* The seed a level asks its history for (S263) — ONE owner, read by every host that builds a history from a level:
 * the app session, the embed mount and blockoide's embed.
 *
 * ★ Substrates key it two ways. `rng_seed` is the history's own name; `seed` is what a dozen substrates chose, and
 * until S263 every host read `rng_seed ?? 1` — so a level's `seed` never reached the threaded RNG and every such
 * substrate that draws from it (cauce, diagonales, meta-cosa, quinuu, caminitos, rgba's rain, …) ran the seed-1
 * trajectory live while its own tests ran the one the level asked for. No test could see it: they seed the RNG from
 * `cfg.seed` directly.
 *
 * `rng_seed` wins when it is a number (conway's `seed` is a starting PATTERN, not a seed). A seed that is present
 * but not a finite number is refused, never defaulted; so is a level giving two different numeric seeds. */
export function levelSeed(config: unknown): number {
  const c = (typeof config === "object" && config !== null ? config : {}) as { rng_seed?: unknown; seed?: unknown };
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (c.rng_seed !== undefined && !finite(c.rng_seed)) {
    throw new Error(`levelSeed: rng_seed must be a finite number, got ${String(c.rng_seed)}`);
  }
  if (finite(c.rng_seed)) {
    if (finite(c.seed) && c.seed !== c.rng_seed) {
      throw new Error(`levelSeed: the level gives two seeds (rng_seed ${c.rng_seed}, seed ${c.seed}) — which one runs is not decidable`);
    }
    return c.rng_seed;
  }
  if (c.seed === undefined) return 1;
  if (!finite(c.seed)) throw new Error(`levelSeed: seed must be a finite number when there is no rng_seed, got ${String(c.seed)}`);
  return c.seed;
}
