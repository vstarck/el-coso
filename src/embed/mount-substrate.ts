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

import { createHistory, historyReset, type HistoryAdapter } from "@/history";
import { mountHost, type TouchAction } from "@/lib/lens-host/mount-host";
import { makeLensHost } from "@/lib/lens-host/host";
import type {
  EmbedCommandSpec,
  Lens,
  LensTunable,
  RenderSize,
  TunableValue,
} from "@/lenses/types";

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
  /** Start with looping on, if the substrate honours `config.loop` (a
   *  presentational substrate that restarts itself at the end of its run).
   *  Toggleable at runtime via the handle's `setLoop`. */
  loop?: boolean;
  /** Opaque precompiled state a substrate's lens may consume to skip a costly
   *  mount-time derivation (e.g. moving-swarm's tagged-particle blob). Folded
   *  into the level as `config.precomputed`; the lens validates + falls back. */
  precomputed?: unknown;
  /** `touch-action` for the embed frame — the page-scroll vs. capture policy on
   *  touch devices. `none` = full any-direction capture (interactive embeds;
   *  the page can't scroll over it); `pan-y` = vertical scroll passes through,
   *  horizontal drags captured (good-citizen feed default). Omit ⇒ the page
   *  scrolls normally (a drag over the canvas pans the page). */
  touchAction?: TouchAction;
};

// The embedding page drives the embed through this handle — wire buttons to it.
export type EmbedHandle = {
  destroy(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  isPlaying(): boolean;
  /** Restart the run from its initial state (lens `reset` if it has one, else a
   *  generic history reset). */
  reset(): void;
  /** Enable/disable self-looping (substrates that honour `config.loop`). */
  setLoop(on: boolean): void;
  /** Read a lens/config tunable by dotted path (spec/25). */
  getTunable(path: string[]): TunableValue | undefined;
  /** Write a lens/config tunable by dotted path (spec/25). */
  setTunable(path: string[], value: TunableValue): void;
  /** Dispatch a substrate-specific named command (spec/25). THROWS if the lens
   *  declares no command surface or rejects the name — never a silent no-op, so
   *  the caller / SDK can surface it. */
  command(name: string, ...args: unknown[]): void;
  /** Discovery manifest for the embed SDK: the mounted lens id + its declared
   *  tunables and commands. */
  describe(): {
    lens: string;
    tunables: LensTunable[];
    commands: EmbedCommandSpec[];
  };
};

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

  if (config.precomputed !== undefined) {
    (level as Record<string, unknown>).precomputed = config.precomputed;
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
    ...(config.touchAction ? { touchAction: config.touchAction } : {}),
  });

  // Apply post-mount config: lens-target tunables, speed, autoplay, loop.
  for (const { path, value } of lensTunables) mounted.tree.root.setTunable(path, value);
  if (config.speed) mounted.tree.root.setSpeed(config.speed);
  if (config.autoplay === false) host.setPlaying(false);
  const setLoop = (on: boolean): void => {
    (history.config as { loop?: boolean }).loop = on;
  };
  if (config.loop !== undefined) setLoop(config.loop);

  return {
    destroy: () => mounted.unmount(),
    play: () => host.setPlaying(true),
    pause: () => host.setPlaying(false),
    toggle: () => host.togglePlaying(),
    isPlaying: () => host.isPlaying(),
    reset: () => {
      const lensReset = mounted.tree.root.reset;
      if (lensReset) lensReset();
      else historyReset(history);
    },
    setLoop,
    getTunable: (path) => mounted.tree.root.getTunable(path),
    setTunable: (path, value) => mounted.tree.root.setTunable(path, value),
    command: (name, ...args) => {
      const dispatch = mounted.tree.root.command;
      if (!dispatch) {
        throw new Error(
          `embed: lens "${lensId}" declares no command surface (command "${name}" rejected)`,
        );
      }
      dispatch(name, args); // the lens throws on an unknown name; we let it propagate
    },
    describe: () => ({
      lens: lensId,
      tunables: lens.tunables,
      commands: lens.commands ?? [],
    }),
  };
}
