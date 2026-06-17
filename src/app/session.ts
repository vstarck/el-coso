/* Session — chrome-facing object that composes one History + one mounted
 * Lens. Module-level singleton; the History is created at load time so
 * the chrome can render against something real immediately. The
 * MountedLens slot is filled when SubstrateHost mounts.
 *
 * Type parameters are deliberately erased to `any` at the session
 * boundary so the chrome can hold one substrate today and a different
 * one tomorrow without rewriting all consumers. Substrate-internal code
 * (the lens mount, the bundle, the adapter) stays fully typed; only the
 * cross-substrate seam loses precision.
 *
 * Per-substrate lens plurality: the active lens is a derived
 * lookup against the active substrate's `lenses` map by id. Mid-session
 * lens switching goes through `setLens` and re-mounts via bumpSession.
 */

import { createHistory, type History } from "../history";
import { clearThumbnailCache } from "./lib/thumbnail";
import {
  findPuzzle,
  resolveInitialSelection,
  SUBSTRATE_BY_ID,
  SUBSTRATES,
  type PuzzleEntry,
  type SubstrateEntry,
  writeSelectionToUrl,
} from "./substrates";
import {
  activeFrame,
  resetStack,
  type SceneFrame,
} from "./lib/scenes/scene-stack";
import { reviewFrame, setDrillRegistry } from "./lib/scenes/drill-in";
import type { Lens, MountedLens, RenderSize } from "@/lenses/types";
import type { ChromePanelsConfig } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Session is a projection of the scene stack's ACTIVE (top) frame:
// `history` / `active_*` read the active frame, so chrome consumers that
// already re-read after a version bump pick up the child scene while it is
// active and the parent again on resume — with no API change. `mounted_lens`
// is the one true field (the host fills it on mount).
export type SessionShape = {
  readonly history: History<any, any, any, any>;
  readonly active_substrate_id: string;
  readonly active_puzzle_id: string;
  readonly active_lens_id: string;
  /** Derived: the live `Lens` object resolved via
   * `SUBSTRATE_BY_ID[active_substrate_id].lenses[active_lens_id]`.
   * Read each access; chrome consumers (Toolbar, SubstrateHost,
   * StatusLine, etc.) already re-read after `bumpSession` / `bumpScene`. */
  readonly active_lens: Lens<any, any, any, any>;
  mounted_lens: MountedLens<any> | null;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function buildHistoryFor(substrate: SubstrateEntry, puzzle: PuzzleEntry) {
  const config = substrate.parseLevel(puzzle.json);
  const adapter =
    typeof substrate.adapter === "function"
      ? substrate.adapter(config)
      : substrate.adapter;
  return createHistory({
    bundle: substrate.bundle,
    config,
    rng_seed: typeof config.rng_seed === "number" ? config.rng_seed : 1,
    adapter,
    keyframe_period: substrate.keyframePeriod,
  });
}

function buildRootFrame(
  substrate: SubstrateEntry,
  puzzle: PuzzleEntry,
  lensId: string,
): SceneFrame {
  return {
    history: buildHistoryFor(substrate, puzzle),
    substrate_id: substrate.id,
    puzzle_id: puzzle.id,
    lens_id: lensId,
  };
}

// Inject the substrate registry into drill-in's A′ resolver. Done
// here — where SUBSTRATES is already imported — so drill-in.ts stays free of
// the chrome lens graph and importable headless.
setDrillRegistry(SUBSTRATES);

const initial = resolveInitialSelection();
resetStack(buildRootFrame(initial.substrate, initial.puzzle, initial.lensId));

export const session: SessionShape = {
  // While drilled in, `history` / `active_lens` project the
  // REVIEW frame instead of the scene-stack active frame, so every consumer
  // reading `session.history` (the timeline view, the host, the preview)
  // shows the inner tree + its child lens (A′) with no per-consumer change.
  // The id getters keep projecting the active (parent) frame — review is a
  // view of the parent's timeline, not a substrate switch.
  get history() {
    return reviewFrame()?.history ?? activeFrame().history;
  },
  get active_substrate_id() {
    return activeFrame().substrate_id;
  },
  get active_puzzle_id() {
    return activeFrame().puzzle_id;
  },
  get active_lens_id() {
    return activeFrame().lens_id;
  },
  get active_lens() {
    const review = reviewFrame();
    if (review) return review.lens;
    const frame = activeFrame();
    const sub = SUBSTRATE_BY_ID[frame.substrate_id]!;
    return sub.lenses[frame.lens_id] ?? sub.lenses[sub.defaultLensId]!;
  },
  mounted_lens: null,
};

// Swap the active substrate + puzzle. The caller (toolbar) is responsible
// for bumping the store's sessionVersion so SubstrateHost re-mounts the
// lens against the fresh history. Idempotent — calling with the current
// selection is a no-op. The lens resets to the new substrate's default;
// cross-substrate lens carry-over isn't meaningful (lenses are
// substrate-bound).
export function setSubstrate(substrate_id: string, puzzle_id?: string): boolean {
  const substrate = SUBSTRATE_BY_ID[substrate_id];
  if (!substrate) return false;
  const pid = puzzle_id ?? substrate.defaultPuzzle;
  const puzzle = findPuzzle(substrate, pid) ?? findPuzzle(substrate, substrate.defaultPuzzle);
  if (!puzzle) return false;
  if (
    session.active_substrate_id === substrate.id &&
    session.active_puzzle_id === puzzle.id
  ) {
    return false;
  }
  // Null the mounted lens synchronously before swapping history. Without
  // this, anything that reads (session.mounted_lens, session.history)
  // during the same render — e.g. CompareOverlay / PreviewCard useMemo
  // calling captureThumbnail — would pair the *old* lens's renderer with
  // the *new* substrate's state, crashing inside the lens.
  // SubstrateHost's effect cleanup still calls unmount() on its captured
  // reference; we just stop exposing the stale lens via the session.
  session.mounted_lens = null;
  clearThumbnailCache();
  // A substrate / puzzle swap resets the scene stack to a single root frame
  // (any suspended scene is discarded).
  resetStack(buildRootFrame(substrate, puzzle, substrate.defaultLensId));
  writeSelectionToUrl(substrate.id, puzzle.id, substrate.defaultLensId);
  return true;
}

// Chrome panel config for a substrate (which panels are available + which
// default-open). The store applies this at boot and on each substrate switch;
// puzzle/lens swaps within a substrate leave the panels alone.
export function chromePanelsFor(
  substrate_id: string,
): ChromePanelsConfig | undefined {
  return SUBSTRATE_BY_ID[substrate_id]?.chrome;
}

// The substrate's fixed render envelope, if it declares one. The host reads
// this to size + center the lens-tree box; absent ⇒ full-bleed.
export function renderSizeFor(substrate_id: string): RenderSize | undefined {
  return SUBSTRATE_BY_ID[substrate_id]?.renderSize;
}

// Convenience for the puzzle picker — keeps the current substrate, swaps
// only the puzzle. Returns true if anything actually changed.
export function setPuzzle(puzzle_id: string): boolean {
  return setSubstrate(session.active_substrate_id, puzzle_id);
}

// Swap the active lens within the current substrate. Returns true if
// anything changed. Same lifecycle as substrate/puzzle switching — caller
// bumps sessionVersion so SubstrateHost re-mounts the new lens. History
// is preserved across the switch.
export function setLens(lens_id: string): boolean {
  const frame = activeFrame();
  const sub = SUBSTRATE_BY_ID[frame.substrate_id]!;
  if (!sub.lenses[lens_id]) return false;
  if (frame.lens_id === lens_id) return false;
  session.mounted_lens = null;
  clearThumbnailCache();
  frame.lens_id = lens_id;
  writeSelectionToUrl(frame.substrate_id, frame.puzzle_id, lens_id);
  return true;
}
