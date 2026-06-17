/* Spec §8 — global keyboard bindings, table-driven.
 *
 * Two contracts:
 *
 * 1. **Bindings are data.** `DEFAULT_CHROME_KEYS` maps action → chord, and
 *    `useKeyboard(overrides)` accepts a partial remap, so rebinding is a
 *    caller decision (chrome settings, a puzzle's view-tier fields, a test)
 *    rather than an edit here. Chord syntax: optional `"Mod+"` (ctrl or
 *    meta), then `event.code` for the layout-stable keys (Space / Home /
 *    End) or `event.key` (single chars lowercased) otherwise.
 *
 * 2. **A handled key is never re-handled.** Any earlier handler that calls
 *    `preventDefault()` — in particular a lens that owns gameplay keys via
 *    a capture-phase listener — makes the chrome yield that event. This is
 *    what lets a substrate use keys the chrome also binds without the two
 *    fighting (the pentris Workbench is the worked example).
 */

import { useEffect } from "react";
import { goBackToCommit } from "@/app/lib/bttf";
import { session } from "@/app/session";
import { useStore } from "@/app/store";

const STEP = 50; // ticks per step_back / step_forward press

export type ChromeKeyAction =
  | "toggle_play"
  | "step_back"
  | "step_forward"
  | "go_start"
  | "go_head"
  | "palette"
  | "commit_rules"
  | "compare";

export const DEFAULT_CHROME_KEYS: Record<ChromeKeyAction, string> = {
  toggle_play: "Space",
  step_back: ",",
  step_forward: ".",
  go_start: "Home",
  go_head: "End",
  palette: "Mod+k",
  commit_rules: "Mod+Enter",
  compare: "c",
};

// Actions that swallow the browser default (scroll, find-as-you-type, …).
const PREVENT_DEFAULT: ReadonlySet<ChromeKeyAction> = new Set([
  "toggle_play",
  "palette",
  "commit_rules",
]);

function chordOf(e: KeyboardEvent): string {
  const mod = e.metaKey || e.ctrlKey ? "Mod+" : "";
  const base =
    e.code === "Space" || e.code === "Home" || e.code === "End"
      ? e.code
      : e.key.length === 1
        ? e.key.toLowerCase()
        : e.key;
  return mod + base;
}

export function useKeyboard(
  overrides?: Partial<Record<ChromeKeyAction, string>>,
) {
  useEffect(() => {
    const table: Record<ChromeKeyAction, string> = {
      ...DEFAULT_CHROME_KEYS,
      ...overrides,
    };
    const chordToAction = new Map<string, ChromeKeyAction>();
    for (const action of Object.keys(table) as ChromeKeyAction[]) {
      chordToAction.set(table[action], action);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // a lens owned this key

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }

      const action = chordToAction.get(chordOf(e));
      if (!action) return;
      if (PREVENT_DEFAULT.has(action)) e.preventDefault();

      const s = useStore.getState();
      switch (action) {
        case "toggle_play":
          s.togglePlaying();
          return;
        case "step_back":
          s.setPlayheadTick(Math.max(0, s.playheadTick - STEP));
          return;
        case "step_forward":
          s.setPlayheadTick(s.playheadTick + STEP);
          return;
        case "go_start":
          s.setPlayheadTick(0);
          return;
        case "go_head": {
          // Jump to the live frontier (active branch's head_tick),
          // mirroring the inspector's go-to-head. goBackToCommit re-anchors
          // the substrate and preserves play/pause.
          const h = session.history;
          const active = h.branches[h.active];
          if (active) {
            goBackToCommit({ branchId: active.id, tick: active.head_tick });
          }
          return;
        }
        case "palette":
          return; // placeholder
        case "commit_rules":
          s.commitRules();
          return;
        case "compare":
          if (s.compareOpen) s.closeCompare();
          else s.openCompare();
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overrides]);
}
