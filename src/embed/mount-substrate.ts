/* Generic, registry-free substrate embed.
 *
 * `mountSubstrate(target, substrate, config)` is the store-free, React-free
 * mount for ANY substrate whose lenses talk to their host through the
 * `LensHost` seam (i.e. don't import `@/app/store`). It takes a single
 * substrate *barrel* — the normalized `{ meta, puzzles, lenses, defaultLensId,
 * bundle, adapter, parseLevel }` shape every `src/substrates/<id>/index.ts`
 * exports — and never the app registry, so an export bundle pulls in only the
 * one substrate it targets (and stays React-free if that substrate is
 * migrated).
 *
 * "Everything setupable" (the export pipeline's contract): `config` can pin
 * the puzzle, lens, seed, speed, autoplay, and any lens/config tunable. Config-
 * target tunables are merged into the parsed level *before* the history is
 * built; lens-target tunables go through `setTunable` after mount; speed via
 * the lens's `setSpeed`. All reuse surfaces that already exist — no new lens
 * API.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHistory, type HistoryAdapter } from "@/history";
import { mountHost } from "@/lib/lens-host/mount-host";
import { makeLensHost } from "@/lib/lens-host/host";
import type { Lens, RenderSize, TunableValue } from "@/lenses/types";

// The normalized barrel shape. Mirrors what the app registry reads off each
// `import * as Sub from "@/substrates/<id>"`, minus the cross-substrate
// erasure the chrome needs.
export type SubstrateModule = {
  meta: {
    id: string;
    name: string;
    defaultPuzzle: string;
    keyframePeriod: number;
    renderSize?: RenderSize;
  };
  puzzles: ReadonlyArray<{ id?: string; description?: string } & object>;
  lenses: Record<string, Lens<any, any, any, any>>;
  defaultLensId: string;
  bundle: any;
  adapter: HistoryAdapter<any, any, any> | ((config: any) => HistoryAdapter<any, any, any>);
  parseLevel: (json: any) => any;
};

export type EmbedConfig = {
  /** Puzzle id (defaults to the substrate's `defaultPuzzle`). */
  puzzle?: string;
  /** Lens id (defaults to the substrate's `defaultLensId`). */
  lens?: string;
  /** RNG seed override (defaults to the level's `rng_seed`, then 1). */
  seed?: number;
  /** Speed preset id (one of the lens's `speeds`). */
  speed?: string;
  /** Start running on mount. Defaults to true. */
  autoplay?: boolean;
  /** Any tunable, keyed by dotted path (e.g. "show_tick_counter" or
   *  "physics.gravity"). Config-target tunables merge into the level;
   *  lens-target tunables are applied via the mounted lens. */
  tunables?: Record<string, TunableValue>;
};

export type EmbedHandle = { destroy(): void };

function findPuzzleJson(substrate: SubstrateModule, id: string | undefined): unknown {
  const wanted = id ?? substrate.meta.defaultPuzzle;
  const hit =
    substrate.puzzles.find((p) => (p as { id?: string }).id === wanted) ??
    substrate.puzzles.find((p) => (p as { id?: string }).id === substrate.meta.defaultPuzzle) ??
    substrate.puzzles[0];
  return hit;
}

// Deep-set a dotted path on a plain object (config-target tunables). Mutates
// `obj`; only walks/creates plain-object segments.
function deepSet(obj: Record<string, any>, path: string[], value: unknown): void {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key];
  }
  cur[path[path.length - 1]!] = value;
}

export function mountSubstrate(
  target: HTMLElement | string,
  substrate: SubstrateModule,
  config: EmbedConfig = {},
): EmbedHandle {
  const el =
    typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`mountSubstrate: target not found (${String(target)})`);

  const lensId =
    (config.lens && substrate.lenses[config.lens] && config.lens) ?? substrate.defaultLensId;
  const lens = substrate.lenses[lensId]!;

  // Parse the chosen puzzle into a level config, then fold in config-target
  // tunables (the lens declares which paths target "config") BEFORE history
  // construction — those values are baked into the run, not toggled live.
  const level = substrate.parseLevel(findPuzzleJson(substrate, config.puzzle));
  const lensTunables: Array<{ path: string[]; value: TunableValue }> = [];
  if (config.tunables) {
    for (const [dotted, value] of Object.entries(config.tunables)) {
      const path = dotted.split(".");
      const decl = lens.tunables.find((t) => t.path.join(".") === dotted);
      if (decl?.target === "config") {
        deepSet(level as Record<string, any>, path, value);
      } else {
        lensTunables.push({ path, value });
      }
    }
  }

  const seed =
    config.seed ?? (level as { rng_seed?: number }).rng_seed ?? 1;
  const adapter =
    typeof substrate.adapter === "function" ? substrate.adapter(level) : substrate.adapter;
  const history = createHistory({
    bundle: substrate.bundle,
    config: level,
    rng_seed: seed,
    adapter,
    keyframe_period: substrate.meta.keyframePeriod,
  });

  const host = makeLensHost({
    ...(config.speed ? { speedId: config.speed } : {}),
  });
  const mounted = mountHost(el, lens, history, {
    host,
    renderSize: substrate.meta.renderSize,
  });

  // Apply post-mount config: lens-target tunables, speed, autoplay.
  for (const { path, value } of lensTunables) mounted.tree.root.setTunable(path, value);
  if (config.speed) mounted.tree.root.setSpeed(config.speed);
  if (config.autoplay === false) host.setPlaying(false);

  return {
    destroy(): void {
      mounted.unmount();
    },
  };
}
