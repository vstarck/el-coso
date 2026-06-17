/* Scene registry — the scene-transition contract in code. A
 * `SceneDef` per `spawn.kind` ties a parent's spawn payload to a child
 * substrate frame and back.
 *
 * The concrete defs live WITH the substrate that spawns them: a substrate
 * package that participates in a scene ships a `scene.ts` exporting
 * `scenes: SceneDef[]`, registered here via `registerScenes` when the host
 * loads its substrates (the app/overlay globs them; tests register directly).
 * This file therefore names no specific substrate — the pair stays decoupled,
 * each emitting / consuming a self-describing, structurally-typed payload.
 */

import type { SceneFrame } from "./scene-stack";

// Base spawn payload. Substrate-specific payloads extend it with a
// discriminant-matched `kind` + their own fields; the runtime reads them
// duck-typed off the head commit.
export type ScenePayload = { kind: string };

export type SceneDef = {
  kind: string;
  // Build the child frame (seeded history + substrate/lens ids) from the
  // parent's spawn payload (Level 0).
  spawnChild: (spawn: ScenePayload) => SceneFrame;
  // Read the child substrate state: return the terminal payload when the
  // child has terminated, else null (still in progress).
  childTerminal: (child_state: unknown) => unknown | null;
  // Turn the child's terminal payload into the parent's resolve INPUT (the
  // value handed to historyTick on the parent). Parent-integrate itself
  // lives in the parent substrate's tick (R4: pure fn of payload).
  parentResolveInput: (terminal: unknown) => unknown;
};

// Populated by substrate loading (a participating package exports `scenes`).
// Mutated in place so importers (scene-stack) keep the same reference. Empty
// until something registers — a host with no scene substrate simply has none.
export const SCENE_DEFS: Record<string, SceneDef> = {};

export function registerScenes(defs: readonly SceneDef[] | undefined): void {
  if (!defs) return;
  for (const def of defs) {
    if (!SCENE_DEFS[def.kind]) SCENE_DEFS[def.kind] = def;
  }
}
