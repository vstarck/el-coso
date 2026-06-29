import { create } from "zustand";
import { HEAD_COMMIT_ID, headParams } from "./fixtures/tree";
import type { Params } from "@/lib/types";
import { ZERO_FPS, type FpsStats } from "@/lib/lens-host/fps-stats";
import type { DrillStep } from "./lib/scenes/drill-in";

type Theme = "dark" | "light";

const THEME_KEY = "el-coso-theme";
const UI_SCALE_KEY = "el-coso-ui-scale";
const FONT_SCALE_KEY = "el-coso-font-scale";
const FPS_CAP_KEY = "el-coso-fps-cap";
const PANELS_KEY = "el-coso-panels";

export const UI_SCALES = [0.9, 1.0, 1.1, 1.25] as const;
export type UiScale = (typeof UI_SCALES)[number];
const DEFAULT_UI_SCALE: UiScale = 1.0;

export const FONT_SCALES = [0.9, 1.0, 1.1, 1.25] as const;
export type FontScale = (typeof FONT_SCALES)[number];
const DEFAULT_FONT_SCALE: FontScale = 1.0;

// Render-rate ceiling for `attachRafLoop`. 0 = uncapped (sync to monitor
// refresh). 60 default normalizes feel across 60/120/144Hz monitors —
// `attachRafLoop`'s tick accumulator advances per-frame, so an uncapped
// 120Hz monitor would run the substrate twice as fast in real time as a
// 60Hz one at the same speed setting.
export const FPS_CAPS = [30, 60, 120, 0] as const;
export type FpsCap = (typeof FPS_CAPS)[number];
const DEFAULT_FPS_CAP: FpsCap = 60;

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const v = window.localStorage.getItem(THEME_KEY);
  return v === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(THEME_KEY, theme);
}

function readStoredUiScale(): UiScale {
  if (typeof window === "undefined") return DEFAULT_UI_SCALE;
  const raw = window.localStorage.getItem(UI_SCALE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return (UI_SCALES as readonly number[]).includes(parsed)
    ? (parsed as UiScale)
    : DEFAULT_UI_SCALE;
}

function applyUiScale(scale: UiScale) {
  // CSS `zoom` scales fonts + layout together. Set as a string so the
  // browser treats `1` as identity rather than dropping the property.
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string })
    .zoom = String(scale);
  window.localStorage.setItem(UI_SCALE_KEY, String(scale));
}

function readStoredFontScale(): FontScale {
  if (typeof window === "undefined") return DEFAULT_FONT_SCALE;
  const raw = window.localStorage.getItem(FONT_SCALE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return (FONT_SCALES as readonly number[]).includes(parsed)
    ? (parsed as FontScale)
    : DEFAULT_FONT_SCALE;
}

function applyFontScale(scale: FontScale) {
  document.documentElement.style.setProperty("--font-scale", String(scale));
  window.localStorage.setItem(FONT_SCALE_KEY, String(scale));
}

function readStoredFpsCap(): FpsCap {
  if (typeof window === "undefined") return DEFAULT_FPS_CAP;
  const raw = window.localStorage.getItem(FPS_CAP_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return (FPS_CAPS as readonly number[]).includes(parsed)
    ? (parsed as FpsCap)
    : DEFAULT_FPS_CAP;
}

function applyFpsCap(cap: FpsCap) {
  window.localStorage.setItem(FPS_CAP_KEY, String(cap));
}

export type PanelId = "toolbar" | "inspector" | "rules" | "timeline";
export type PanelsState = Record<PanelId, boolean>;

export const ALL_PANELS: PanelId[] = [
  "toolbar",
  "inspector",
  "rules",
  "timeline",
];

// Panels open by default when a substrate doesn't declare `defaultOpen`. The
// history timeline + commit inspector start closed so first paint stays focused
// on the substrate itself; the user reopens them and that choice persists
// (see PanelPrefs below). Toolbar + rules stay open by default.
export const DEFAULT_OPEN_PANELS: readonly PanelId[] = ["toolbar", "rules"];

// Per-substrate chrome configuration, declared substrate-side on `meta` and
// projected into the SubstrateEntry. Two positive-statement bags (the
// lens-features-bag convention): `available` = which panels the substrate
// offers at all (omitted ⇒ all four); `defaultOpen` = which of those are open
// at boot / on a substrate switch (omitted ⇒ DEFAULT_OPEN_PANELS). The user's
// own toggles persist and overlay these (see resolveChromePanels).
export type ChromePanelsConfig = {
  available?: readonly PanelId[];
  defaultOpen?: readonly PanelId[];
};

// The user's persisted panel toggles, keyed by panel — only panels the user
// has actually opened/closed appear here. Overlaid on the substrate defaults
// so untouched panels still follow substrate intent, but a panel the user
// touched sticks across reloads AND substrate switches.
export type PanelPrefs = Partial<Record<PanelId, boolean>>;

function readStoredPanelPrefs(): PanelPrefs {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(PANELS_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupted localStorage is the recognized gate-it-out case — warn so it
    // isn't a fully silent no-op, then fall back to defaults.
    console.warn(`[store] ignoring corrupt ${PANELS_KEY} in localStorage`);
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const out: PanelPrefs = {};
  for (const id of ALL_PANELS) {
    const v = (parsed as Record<string, unknown>)[id];
    if (typeof v === "boolean") out[id] = v;
  }
  return out;
}

function writeStoredPanelPref(id: PanelId, open: boolean): void {
  if (typeof window === "undefined") return;
  const prefs = readStoredPanelPrefs();
  prefs[id] = open;
  window.localStorage.setItem(PANELS_KEY, JSON.stringify(prefs));
}

// Resolve a config into the two boolean records the chrome reads. Open state =
// substrate defaults, with the user's persisted toggles (`stored`) overlaid.
// An unavailable panel is never open, whatever `defaultOpen` or `stored` lists.
export function resolveChromePanels(
  config?: ChromePanelsConfig,
  stored: PanelPrefs = {},
): {
  panels: PanelsState;
  availablePanels: PanelsState;
} {
  const available = config?.available ?? ALL_PANELS;
  const isAvailable = (id: PanelId) => available.includes(id);
  const defaultOpen = (config?.defaultOpen ?? DEFAULT_OPEN_PANELS).filter(
    isAvailable,
  );
  const record = (members: readonly PanelId[]): PanelsState =>
    Object.fromEntries(
      ALL_PANELS.map((id) => [id, members.includes(id)]),
    ) as PanelsState;
  const panels = record(defaultOpen);
  for (const id of ALL_PANELS) {
    if (stored[id] !== undefined && isAvailable(id)) panels[id] = stored[id]!;
  }
  return { panels, availablePanels: record(available) };
}

export type CompareMode = "split" | "wipe" | "onion";

export type AppState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;

  panels: PanelsState;
  // Which panels the active substrate offers — drives whether App renders
  // each panel/stub at all. Set alongside `panels` by applyChromePanels.
  availablePanels: PanelsState;
  setPanel: (id: PanelId, open: boolean) => void;
  togglePanel: (id: PanelId) => void;
  // Apply a substrate's chrome config (at boot + on substrate switch).
  applyChromePanels: (config?: ChromePanelsConfig) => void;

  // Spec §1 — transport
  playing: boolean;
  playheadTick: number;
  fps: FpsStats;
  speedId: string;
  setPlayheadTick: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setSpeedId: (id: string) => void;
  setFps: (stats: FpsStats) => void;

  // Bumped by the lens when history structure changes (commit emitted,
  // branch created/deleted, truncate). Components reading from
  // session.history subscribe to this to re-derive their views. Tick-only
  // advances do NOT bump — they push playheadTick instead.
  historyVersion: number;
  bumpHistoryVersion: () => void;

  // Bumped on substrate / puzzle switch — SubstrateHost reads this as a
  // re-mount signal so it can tear down the old lens against the old
  // history and rebuild against whatever session.ts now points at.
  sessionVersion: number;
  bumpSession: () => void;
  // Lens-only swap: history is preserved, so cursors / selection / playhead
  // must NOT reset. (`bumpSession` resets playheadTick to 0, which is the
  // correct shape for a fresh substrate / puzzle but enters the tick
  // driver's replay branch on lens swap — biases queued after the swap
  // sit in `pending_biases` until replay catches up to head_tick.)
  bumpSessionLensOnly: () => void;

  // Bumped on a scene push (suspend parent, mount child) or pop (resume
  // parent) — SubstrateHost re-mounts against the new active frame, same
  // signal as sessionVersion but without resetting cursors (the scene
  // runtime owns playhead). `sceneDirection` tells the host which cutscene
  // to play in the unmount→mount gap; null = instant cut (substrate swap,
  // initial mount). See src/app/lib/scenes.
  sceneVersion: number;
  sceneDirection: "enter" | "exit" | null;
  bumpScene: (direction: "enter" | "exit") => void;

  // Drill-in — read-only review navigation into recursive commits.
  // Empty `drill` = not reviewing (host projects the scene-stack frame); a
  // non-empty path means the LAST step is what the host mounts. The path
  // holds retained child histories (drill-in.ts is the primitive over it).
  // `drillReturnTick` stashes the parent's playhead so leaving review
  // restores it. `drillVersion` is the host re-mount bump (instant cut).
  drill: DrillStep[];
  drillReturnTick: number | null;
  drillVersion: number;
  setDrill: (path: DrillStep[]) => void;
  setDrillReturnTick: (t: number | null) => void;
  bumpDrill: () => void;

  // Selection + hover + scrub
  selectedCommitId: string | null;
  pinned: string[];
  setSelectedCommit: (id: string | null) => void;

  hoveredCommitId: string | null;
  setHoveredCommit: (id: string | null) => void;

  scrubTick: number | null;
  setScrubTick: (t: number | null) => void;

  previewCommitId: string | null;
  previewAnchor: { x: number; y: number } | null;
  openPreview: (id: string, anchor: { x: number; y: number }) => void;
  closePreview: () => void;
  togglePin: (id: string) => void;

  // Bumped to ask the timeline tree to snap its pan back onto the active
  // branch's head. The tree owns the actual pan state; this is the
  // out-of-band kick so the status-line button can reach it without
  // lifting all of pan into the store.
  timelineRecenterToken: number;
  recenterTimeline: () => void;

  // How the timeline spends its pixel budget on the commit stream (see
  // lib/historyLayout FoldStrategy). "none" = windowed/panned (every commit a
  // column); "fit" = whole lineage into the width, uniform folding; "recent" =
  // fit with a gradient (fine near HEAD, coarse toward root) + newest commits
  // kept whole. Cycled from the status line.
  timelineStrategy: "none" | "fit" | "recent";
  cycleTimelineStrategy: () => void;

  // Bumped to ask SubstrateHost to take a PNG snapshot of the live
  // canvas and trigger a download. Same pattern — the canvas owns the
  // ref, the toolbar just kicks the request.
  snapshotToken: number;
  triggerSnapshot: () => void;

  // Overlays
  kitchenSinkOpen: boolean;
  helpOpen: boolean;
  settingsOpen: boolean;
  // Substrate gallery — the "browse all" modal opened from the toolbar's
  // compact (favorites-only) substrate picker.
  galleryOpen: boolean;
  toggleKitchenSink: () => void;
  toggleHelp: () => void;
  toggleSettings: () => void;
  openGallery: () => void;
  closeGallery: () => void;

  uiScale: UiScale;
  setUiScale: (s: UiScale) => void;

  fontScale: FontScale;
  setFontScale: (s: FontScale) => void;

  fpsCap: FpsCap;
  setFpsCap: (cap: FpsCap) => void;

  // Per-tunable-group visibility for the Rules rail. Each group (as
  // declared by the lens's tunables) is independently openable. Default
  // empty = every group starts closed; the user expands the ones they
  // need so the rail stays under the timeline ceiling. Keyed by group
  // name; reset when sessionVersion bumps so switching substrates
  // doesn't carry stale group names.
  openRulesGroups: Record<string, true>;
  toggleRulesGroup: (name: string) => void;

  // Rules working copy
  rules: Params;
  setRule: (id: string, value: number | boolean | string) => void;
  commitRules: () => void;
  discardRules: () => void;

  // Compare
  compareOpen: boolean;
  compareA: string;
  compareB: string;
  compareMode: CompareMode;
  openCompare: (a?: string, b?: string) => void;
  closeCompare: () => void;
  setCompareMode: (m: CompareMode) => void;
};

export const useStore = create<AppState>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },

  ...resolveChromePanels(undefined, readStoredPanelPrefs()),
  setPanel: (id, open) => {
    writeStoredPanelPref(id, open);
    set((s) => ({ panels: { ...s.panels, [id]: open } }));
  },
  togglePanel: (id) =>
    set((s) => {
      const open = !s.panels[id];
      writeStoredPanelPref(id, open);
      return { panels: { ...s.panels, [id]: open } };
    }),
  applyChromePanels: (config) =>
    set(resolveChromePanels(config, readStoredPanelPrefs())),

  playing: false,
  playheadTick: 0,
  fps: ZERO_FPS,
  speedId: "turn",
  setPlayheadTick: (t) => set({ playheadTick: t }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setSpeedId: (id) => set({ speedId: id }),
  setFps: (stats) => set({ fps: stats }),

  historyVersion: 0,
  bumpHistoryVersion: () =>
    set((s) => ({ historyVersion: s.historyVersion + 1 })),

  sessionVersion: 0,
  bumpSession: () =>
    set((s) => ({
      sessionVersion: s.sessionVersion + 1,
      // Bumping historyVersion too keeps every panel reading
      // session.history in sync — same lifecycle, one signal.
      historyVersion: s.historyVersion + 1,
      // Reset cursors and selection so we don't carry references to the
      // previous substrate's commit ids.
      playheadTick: 0,
      selectedCommitId: null,
      hoveredCommitId: null,
      scrubTick: null,
      previewCommitId: null,
      previewAnchor: null,
      pinned: [],
      playing: false,
      openRulesGroups: {},
      // A substrate / puzzle swap resets the scene stack to its root, so
      // the next host mount is an instant cut, not a scene cutscene.
      sceneDirection: null,
      // ...and exits any drill-in review (the inner tree belonged to the
      // old substrate's timeline).
      drill: [],
      drillReturnTick: null,
    })),
  bumpSessionLensOnly: () =>
    set((s) => ({
      sessionVersion: s.sessionVersion + 1,
      historyVersion: s.historyVersion + 1,
      // No playhead / selection / hover reset — history is preserved
      // across the lens swap, so the cursors are still meaningful.
      // Instant cut (a lens swap is not a scene cutscene).
      sceneDirection: null,
    })),

  sceneVersion: 0,
  sceneDirection: null,
  bumpScene: (direction) =>
    set((s) => ({
      sceneVersion: s.sceneVersion + 1,
      sceneDirection: direction,
      // History structure changed (new active frame); keep panels reading
      // session.history in sync. Cursors are owned by the scene runtime.
      historyVersion: s.historyVersion + 1,
    })),

  drill: [],
  drillReturnTick: null,
  drillVersion: 0,
  setDrill: (path) => set({ drill: path }),
  setDrillReturnTick: (t) => set({ drillReturnTick: t }),
  bumpDrill: () =>
    set((s) => ({
      drillVersion: s.drillVersion + 1,
      // The active history changed (parent ⇄ inner); keep panels reading
      // session.history in sync. Instant cut — review is not a cutscene.
      historyVersion: s.historyVersion + 1,
      sceneDirection: null,
    })),

  selectedCommitId: HEAD_COMMIT_ID,
  pinned: [],
  setSelectedCommit: (id) => set({ selectedCommitId: id }),

  hoveredCommitId: null,
  setHoveredCommit: (id) => set({ hoveredCommitId: id }),

  scrubTick: null,
  setScrubTick: (t) => set({ scrubTick: t }),

  previewCommitId: null,
  previewAnchor: null,
  openPreview: (id, anchor) =>
    set({ previewCommitId: id, previewAnchor: anchor }),
  closePreview: () => set({ previewCommitId: null, previewAnchor: null }),
  togglePin: (id) =>
    set((s) => ({
      pinned: s.pinned.includes(id)
        ? s.pinned.filter((p) => p !== id)
        : [...s.pinned, id],
    })),

  timelineRecenterToken: 0,
  recenterTimeline: () =>
    set((s) => ({ timelineRecenterToken: s.timelineRecenterToken + 1 })),

  timelineStrategy: "none",
  cycleTimelineStrategy: () =>
    set((s) => ({
      timelineStrategy:
        s.timelineStrategy === "none"
          ? "fit"
          : s.timelineStrategy === "fit"
            ? "recent"
            : "none",
    })),

  snapshotToken: 0,
  triggerSnapshot: () =>
    set((s) => ({ snapshotToken: s.snapshotToken + 1 })),

  kitchenSinkOpen: false,
  helpOpen: false,
  settingsOpen: false,
  galleryOpen: false,
  toggleKitchenSink: () => set((s) => ({ kitchenSinkOpen: !s.kitchenSinkOpen })),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  openGallery: () => set({ galleryOpen: true }),
  closeGallery: () => set({ galleryOpen: false }),

  uiScale: readStoredUiScale(),
  setUiScale: (scale) => {
    applyUiScale(scale);
    set({ uiScale: scale });
  },

  fontScale: readStoredFontScale(),
  setFontScale: (scale) => {
    applyFontScale(scale);
    set({ fontScale: scale });
  },

  fpsCap: readStoredFpsCap(),
  setFpsCap: (cap) => {
    applyFpsCap(cap);
    set({ fpsCap: cap });
  },

  openRulesGroups: {},
  toggleRulesGroup: (name) =>
    set((s) => {
      const next = { ...s.openRulesGroups };
      if (next[name]) delete next[name];
      else next[name] = true;
      return { openRulesGroups: next };
    }),

  rules: { ...headParams },
  setRule: (id, value) =>
    set((s) => ({ rules: { ...s.rules, [id]: value } })),
  commitRules: () =>
    set((s) => ({ rules: { ...s.rules } })),
  discardRules: () => set({ rules: { ...headParams } }),

  compareOpen: false,
  compareA: "c-o07",
  compareB: "c-b10",
  compareMode: "split",
  openCompare: (a, b) =>
    set((s) => ({
      compareOpen: true,
      compareA: a ?? s.compareA,
      compareB: b ?? s.compareB,
    })),
  closeCompare: () => set({ compareOpen: false }),
  setCompareMode: (m) => set({ compareMode: m }),
}));

if (typeof document !== "undefined") {
  applyTheme(useStore.getState().theme);
  applyUiScale(useStore.getState().uiScale);
  applyFontScale(useStore.getState().fontScale);
}
