import { expect, test } from "vitest";
import {
  allocSubstrate,
  parseLevel,
  swap,
  tick,
  type DvdConfig,
  type LevelFile,
  type SubstrateState,
} from "../src/substrates/dvd-screensaver";

// Regression net for the dvd-screensaver substrate. Each puzzle runs for
// TICK_COUNT ticks at its authored seed; the final Verlet state is hashed
// (determinism lock). Plus a bounds invariant — the particle must never
// escape [radius, world − radius] — which locks the wall-reflection logic.

const TICK_COUNT = 200;

const LEVELS = import.meta.glob<{ default: LevelFile }>(
  "../src/substrates/dvd-screensaver/puzzles/*.json",
  { eager: true },
);

function hashState(s: SubstrateState): string {
  let h = 0x811c9dc5;
  const feed = (n: number): void => {
    const q = Math.round(n * 1e4);
    h ^= q & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < s.n; i++) {
    feed(s.px[i] ?? 0);
    feed(s.py[i] ?? 0);
    feed(s.ppx[i] ?? 0);
    feed(s.ppy[i] ?? 0);
  }
  feed(s.tick);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function run(level: LevelFile, ticks: number): { final: SubstrateState; config: DvdConfig; escaped: boolean } {
  const config = parseLevel(level);
  const substrate = allocSubstrate(config);
  let rng = { seed: config.rng_seed };
  let escaped = false;
  const eps = 1e-3;
  for (let t = 0; t < ticks; t++) {
    rng = tick(substrate, config, rng, {});
    swap(substrate);
    const s = substrate.read;
    for (let i = 0; i < s.n; i++) {
      const x = s.px[i] ?? 0;
      const y = s.py[i] ?? 0;
      if (
        x < config.radius - eps ||
        x > config.world_w - config.radius + eps ||
        y < config.radius - eps ||
        y > config.world_h - config.radius + eps
      ) {
        escaped = true;
      }
    }
  }
  // Snapshot the read side into a plain object (channels are reused buffers).
  const r = substrate.read;
  const copy = (a: Float32Array) => Float32Array.from(a);
  return {
    final: {
      n: r.n,
      world_w: r.world_w,
      world_h: r.world_h,
      px: copy(r.px),
      py: copy(r.py),
      ppx: copy(r.ppx),
      ppy: copy(r.ppy),
      ax: copy(r.ax),
      ay: copy(r.ay),
      jx: copy(r.jx),
      jy: copy(r.jy),
      tick: r.tick,
    },
    config,
    escaped,
  };
}

const ENTRIES = Object.entries(LEVELS)
  .map(([path, mod]) => ({
    id: (path.split("/").pop() ?? "").replace(/\.json$/, ""),
    level: mod.default,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

test.each(ENTRIES.map((e) => e.id))(
  "%s — 200-tick state hash is stable",
  (puzzle_id) => {
    const entry = ENTRIES.find((e) => e.id === puzzle_id)!;
    const { final } = run(entry.level, TICK_COUNT);
    expect({ puzzle_id, hash: hashState(final) }).toMatchSnapshot();
  },
);

test.each(ENTRIES.map((e) => e.id))(
  "%s — particle never escapes the box",
  (puzzle_id) => {
    const entry = ENTRIES.find((e) => e.id === puzzle_id)!;
    const { escaped } = run(entry.level, TICK_COUNT);
    expect(escaped).toBe(false);
  },
);

// classic-dvd: no gravity + perfect restitution → speed is conserved (up to
// the small jitter). The implicit Verlet speed at the end stays close to the
// authored launch speed.
test("classic-dvd — speed is conserved (no gravity, e=1)", () => {
  const { final, config } = run(levelOf("classic-dvd"), TICK_COUNT);
  const vx = (final.px[0] ?? 0) - (final.ppx[0] ?? 0);
  const vy = (final.py[0] ?? 0) - (final.ppy[0] ?? 0);
  const speed = Math.hypot(vx, vy);
  const launch = Math.hypot(config.init_vx, config.init_vy);
  expect(Math.abs(speed - launch)).toBeLessThan(0.6); // jitter wander only
});

function levelOf(id: string): LevelFile {
  const entry = ENTRIES.find((e) => e.id === id);
  if (!entry) throw new Error(`puzzle ${id} missing`);
  return entry.level;
}
