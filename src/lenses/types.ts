/* Lens contract. App-tier mirror of the lens
 * implementation contract. App-tier code is throwaway; this file does not need
 * to translate.
 */

import type {
  History,
  TickedState,
} from "@/history";
import type { Params, Rule, SpeedOption } from "@/lib/types";

// The third lens-vocabulary surface, alongside renderFrom and
// renderThumbnail. One symbol per commit on the timeline tree:
// commitGlyph(payload) — micro, on the timeline tree.
// `arrow` is a colored disc backdrop + white arrowhead pointing in `dir`;
// chosen as a primitive because directional commits (moves, headings) are
// common across substrates and want to read at-a-glance distinct from
// scalar glyphs.
export type CommitGlyph =
  // Bare circle in the branch's lane color. Default for lenses that
  // don't override.
  | { kind: "circle" }
  // Filled disc in a lens-chosen color — same footprint as the `arrow`
  // glyph. For non-directional lens vocabularies (Conway vitality
  // buckets, density heatmaps, etc.) that want a colored mark.
  | { kind: "disc"; color: string }
  | { kind: "char"; char: string }
  | { kind: "arrow"; dir: "up" | "right" | "down" | "left"; color: string }
  | { kind: "svg"; path: string; viewBox?: string; rotation?: number }
  // Raster image — `src` is whatever URL the lens has on hand (Vite-
  // hashed import, /public path, data URL). Chrome renders it circular-
  // clipped at the same footprint as `disc` / `arrow`.
  | { kind: "image"; src: string };

// Cadence as data — three discriminated unions describing cadence.
// The lens's rAF callback consumes these to decide *when* to call
// historyTick and *how* player inputs land on the active branch.
export type Cadence = {
  sampling_rate:
    | { kind: "every-frame" }
    | { kind: "every-n-ticks"; n: number };
  pause_condition:
    | { kind: "never" }
    | { kind: "after-every-sample" }
    | { kind: "on-event"; event_id: string };
  bias_apply:
    | { kind: "immediate" }
    | { kind: "queued-to-turn-boundary" }
    | { kind: "scheduled" };
};

// A lens-tier tunable extends spec §3 Rule with the config/lens target
// distinction. Chrome's Rules rail (spec §10) writes through the appropriate
// channel based on target.
export type LensTunable = Rule & {
  target: "config" | "lens";
  // Dotted-path field on history.config (target='config') or on
  // mounted.lens_state (target='lens'). The chrome reads + writes through
  // this path.
  path: string[];
};

export type TunableValue = number | boolean | string;

// A substrate-specific named command a lens exposes to the embed SDK (spec/25),
// declared for host discovery. Dispatch is `MountedLens.command` (below). This is
// the escape hatch for verbs that aren't tunables (a terminal `reset`, an
// autopilot toggle, a transit-map toggle). Universal verbs (play/pause/reset)
// stay on the host; tunables stay on the tunable channel.
export type EmbedCommandSpec = {
  // Stable id, e.g. "toggle_autopilot", "rewind".
  name: string;
  // Human label for a generated control. Defaults to `name` at the call site.
  label?: string;
  // Positional arg hints for a generated control; dispatch passes them through.
  args?: ReadonlyArray<{ name: string; type: "number" | "string" | "bool" }>;
};

// What kind of element the lens renders into. Spec/15. Drives a handful of
// chrome layout decisions (CSS perspective wrapper, future target-specific
// affordances). New target kinds extend the union; chrome reads via
// `targetIsPixelSurface` rather than comparing strings inline.
export type RenderTarget = "canvas2d" | "webgl" | "dom" | "ascii";

export function targetIsPixelSurface(
  lens: { target_kind: RenderTarget },
): boolean {
  return lens.target_kind === "canvas2d" || lens.target_kind === "webgl";
}

export type MountedLens<State extends TickedState> = {
  unmount(): void;
  // Pure render pass against arbitrary state. Does NOT advance time, does
  // NOT mutate the history, does NOT assume the loop is paused. Called
  // once per frame by the host's rAF. Composing lenses dispatch this
  // recursively to their children inside their own renderFrom.
  renderFrom(state: State): void;
  // Autonomous tick — advances substrate time. Host's rAF drains the
  // tick accumulator (gated by store.playing + window focus) calling
  // this repeatedly when present. Render-only lenses (a turn-based maze) omit it. Composing lenses typically inherit the tick
  // from the substrate-driving leaf; they don't tick themselves.
  tick?: () => void;
  // Current tick-rate multiplier — host reads this when draining the
  // accumulator so a 4× speed knob means 4× ticks/sec, decoupled from
  // monitor refresh. Lenses without `tick` can omit this. Default 1.
  speedMult?: () => number;
  // Lens-supplied snapshot. Host calls this on the snapshotToken bump
  // and toBlobs the returned canvas. Leaf lenses typically return their
  // own canvas; composing lenses can return an off-screen canvas they
  // composite from children. Lenses without a pixel-surface vocabulary
  // (ASCII, DOM-only) omit it — chrome falls back gracefully.
  snapshot?: () => HTMLCanvasElement | null;
  // Summary render onto a chrome-supplied canvas. Semantically distinct
  // from renderFrom — the lens chooses *composition*, not just scale:
  // renderThumbnail(state, canvas) — the lens owns composition.
  // Optional:
  // lenses whose target vocabulary has no natural Canvas 2D summary
  // (ASCII, chart-shaped DOM) decline; the timeline tree falls back to
  // commitGlyph alone.
  renderThumbnail?: (state: State, canvas: HTMLCanvasElement) => void;
  // One glyph per commit on the timeline tree. The lens reads the commit
  // payload (passed as a flat Params projection) and returns a single
  // symbol that summarizes the event in the lens's vocabulary. The
  // chrome only renders.
  commitGlyph(payload: Params): CommitGlyph;
  pause(): void;
  resume(): void;
  step(): void;
  // Optional lens-tier "restart" — return the run to its initial state (e.g.
  // historyReset + clear lens-local scratch). A host (chrome reset button, embed
  // handle) calls it; absent ⇒ the host falls back to a generic history reset.
  reset?(): void;
  setSpeed(preset_id: string): void;
  // Lens-tier tunable surface — message-passing, not shared memory. The
  // lens owns its tunables privately (closure / class field / whatever);
  // the chrome only interacts through these three methods — tunables are
  // message-passing, not shared memory.
  getTunable(path: string[]): TunableValue | undefined;
  setTunable(path: string[], value: TunableValue): void;
  subscribeTunables(listener: () => void): () => void;
  // Dispatch a substrate-specific named command (spec/25), declared for discovery
  // in `Lens.commands`. Absent ⇒ the lens accepts no named commands; the embed
  // SDK / host MUST surface that as an error, never swallow it. The lens SHOULD
  // throw on an unknown command name (it propagates to the host's error channel).
  command?: (name: string, args: unknown[]) => void;
  // The LIVE command set available right now (spec/26 — "ask, don't read"
  // applied to commands). Absent ⇒ the static `Lens.commands` is the set.
  // Present ⇒ the console reads THIS for help / completion / dispatch, so a
  // substrate whose available verbs change with state can express it; the embed
  // SDK still reads the static `Lens.commands` for `describe()`. Genuinely new
  // commands may appear (not just gray-outs) — it subsumes a per-command enabled
  // flag for the same author effort.
  commands?: () => EmbedCommandSpec[];
  // Middleware wrapped around every BUILT-IN console command dispatch (spec/26
  // — transport, `set`/`get`, `describe`, …). The substrate may: throw (reject —
  // the console prints the error, never silent), `next([...])` (run the default
  // with rewritten args — validate / clamp), ignore `next` (override entirely),
  // or augment its returned message. Absent ⇒ built-ins run directly. Only `set`
  // is exercised today; the seam is general. The substrate's OWN commands
  // (`command` above) are not wrapped — it already owns them.
  interceptCommand?: (
    name: string,
    args: unknown[],
    next: (args?: unknown[]) => string | void,
  ) => string | void;
  // Substrate-specific affordance — drop all player-placed biases. Optional
  // because not every substrate has biases that survive between ticks.
  clearBiases?: () => void;
  // Read a commit's payload and return an outcome banner if it represents
  // a terminal state worth interrupting the player for (win / loss /
  // draw). The chrome's OutcomeDialog polls this on each new head commit
  // and opens a modal when non-null. Lens owns the wording; chrome owns
  // the dialog chrome. Returning null means "this commit is mid-run."
  outcomeFor?: (payload: Params) => OutcomeBanner | null;
  // Lens-supplied scalar readouts for the chrome's HUD strip beside the
  // universal `tick` / `fps` / `seed`. Lens chooses what to surface
  // (agent count, throughput rate, custom physics readings) and how to
  // format the value (`"1461"`, `"55%"`, `"0.43/t"`); chrome only
  // renders. Called once per chrome render (i.e. when `playheadTick`
  // advances), so the cadence matches the rest of the toolbar. Tier
  // discipline: this is a *compression* of substrate state into chrome
  // surface (siblings: `commitGlyph`, `renderThumbnail`); cumulative /
  // smoothed memory is the lens's job.
  hudMetrics?: () => HudMetric[];
};

// One scalar readout in the chrome's HUD strip. The lens emits an
// ordered array; chrome renders them in array order between the play
// controls and the universal `tick`/`fps`/`seed` cluster.
export type HudMetric = {
  /** Stable key for the metric. */
  id: string;
  /** Optional icon, named host-agnostically (e.g. `"droplets"`, `"gauge"`).
   *  The host maps the name to a concrete glyph/component — the contract
   *  carries no rendering-library type. See the React app's `hudIcons`. */
  icon?: string;
  /** Short text label, e.g. `"agents"`, `"conv"`. */
  label: string;
  /** Lens-formatted value text, e.g. `"1461"`, `"55%"`, `"0.43/t"`. */
  value: string;
};

// Lens-authored summary of a terminal commit. Status drives the
// dialog's accent (win/loss/draw colorways); title is the headline,
// body is optional flavor text under it.
export type OutcomeBanner = {
  status: "won" | "lost" | "draw";
  title: string;
  body?: string;
};

// Lens-readable description of how much of the canvas is occluded by
// chrome panels right now. iOS "safe area" analogue: a SAFE_AREA-aware
// lens should place its in-canvas HUD inside the un-occluded rect.
// Numbers are CSS pixels at each edge; PAD is already baked in so the
// HUD gets standard breathing room even when no panel is open.
export type ViewportInset = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

// A fixed render envelope in CSS pixels, declared substrate-side (on `meta`)
// and handed to the lens via `LensMountArgs.renderSize`. When present, the
// host renders the whole lens tree (root + child layers, e.g. an in-canvas
// HUD) inside one centered box of this size instead of full-bleed — so an
// embedded substrate has a known footprint. The substrate states only the
// size; how to spend it (fill, pad the content in for the HUD, etc.) is the
// lens's call.
export type RenderSize = {
  width: number;
  height: number;
};

// The host bridge — the lens's ONLY channel to its host's transport +
// chrome state. Injected via `LensMountArgs.host` so a lens never reaches
// into a concrete store (the "ask, don't read" rule): every member is a
// method, not a field.
//
// Two implementations satisfy it: the React app's store-backed bridge
// (each call delegates to the Zustand store, so the chrome's panels +
// timeline keep re-rendering) and the store-free `makeLensHost` in
// `@/lib/lens-host/host` (a ~40-line observable; the embed/bare host owns
// one). The play-state members are real on both. The timeline members
// (`setPlayheadTick`, `bumpHistoryVersion`) drive the chrome's scrubber +
// tree in the app; in a chrome-less host they store nothing the chrome
// would read but still fire `subscribeHead`, which is how render-only
// (turn-based) lenses re-paint.
export type LensHost = {
  // Transport — the player's "I want this running" intent. AUTOPLAY lenses
  // gate their rAF on it; turn-based lenses pause it after each input.
  isPlaying(): boolean;
  setPlaying(playing: boolean): void;
  togglePlaying(): void;
  // Speed preset id (one of the lens's `speeds`). The host owns the
  // selection so a transport knob in chrome OR embed drives the same lens.
  getSpeedId(): string;
  setSpeedId(id: string): void;
  // Chrome-timeline signals. `playheadTick` is the scrubber position; the
  // lens pushes it as time advances and reads it when it needs the live
  // cursor. `bumpHistoryVersion` announces a structural change (commit,
  // branch, truncate) so chrome re-derives history-backed views. Both fire
  // `subscribeHead`.
  getPlayheadTick(): number;
  setPlayheadTick(tick: number): void;
  getHistoryVersion(): number;
  bumpHistoryVersion(): void;
  // Re-render channel for render-only lenses (no rAF): fires whenever the
  // playhead OR the history version changes. Returns an unsubscribe the
  // lens MUST call in its `unmount`.
  subscribeHead(listener: () => void): () => void;
};

// Spec/15: the chrome hands the lens an opaque host element. The lens
// appends whatever DOM it needs inside (canvas, pre, svg, nested React
// root) and is responsible for sizing + cleanup on unmount.
//
// `subscribeViewport` is the chrome→lens channel for visible-inset
// updates. The contract is tied to the SAFE_AREA feature: chrome always
// hands it over (cheap), but only SAFE_AREA-declaring lenses are
// expected to consume it. The callback fires once immediately with the
// current inset and again on every panel-open/close. Returns an
// unsubscribe — lenses MUST call it in their `unmount` cleanup.
export type LensMountArgs<State extends TickedState, Config, Input, CommitPayload> = {
  container: HTMLElement;
  history: History<State, Config, Input, CommitPayload>;
  // The host bridge — transport + chrome-state, message-passing only. The
  // lens talks to its host (app store / store-free embed) exclusively
  // through this; it must never import a concrete store. See `LensHost`.
  host: LensHost;
  subscribeViewport: (cb: (inset: ViewportInset) => void) => () => void;
  // The substrate's fixed render envelope, if it declares one. The host has
  // already sized + centered the host element to match; the lens reads this
  // only if its internal layout needs the number (e.g. reserving space for a
  // composed HUD). Omitted ⇒ full-bleed, size from the host element.
  renderSize?: RenderSize | undefined;
  // Mounted children — populated when this lens declares `layers`. Host
  // mounts each child first (into its own sibling DOM container), then
  // hands the resulting MountedLens handles here so composing parents
  // can dispatch API resolution (commitGlyph aggregation, snapshot
  // compositing, tunable forwarding) to their children. Rendering is
  // handled by the host calling each mount's `renderFrom` directly each
  // frame — the parent does NOT need to call children's renderFrom.
  children?: ReadonlyArray<MountedLens<State>>;
};

// Binary capability tokens declared by a lens. Positive statements only —
// presence enables behavior; absence is the default. New flags should be
// named so the bare `features: []` lens gets the most generous default.
//
//   AUTOPLAY      — lens runs a rAF loop driving ticks; chrome shows the
//                   Play / Pause button and treats store.playing as the
//                   source of truth for "the user wants this lens
//                   running."
//   SINGLE_BRANCH — branching from tick T re-runs the same evolution, so
//                   the chrome hides the explicit branch button and
//                   replaces checkout with non-destructive "go back
//                   here" + replay-mode loop.
//   BOUNDED       — lens declares a fixed natural size by sizing its own
//                   host element; chrome centers it in the viewport with
//                   negative space around. Implies flat (a tilted
//                   centered canvas reads as a UI bug). Spec/15
//                   replacement for `presentation: "bounded"`.
//   FLAT          — full-bleed but no chrome perspective tilt. For
//                   canvas2d/webgl lenses that handle their own
//                   projection internally, or where the tilt interferes
//                   with click math. Spec/15.
//   SAFE_AREA     — lens renders its own in-canvas HUD and commits to
//                   placing it inside the chrome-published viewport
//                   inset. Tied to `LensMountArgs.subscribeViewport`:
//                   chrome publishes inset updates, lens dodges. Other
//                   lenses ignore the channel; the canvas can still
//                   extend behind chrome panels — they just don't try
//                   to put text there.
export type LensFeature =
  | "AUTOPLAY"
  | "SINGLE_BRANCH"
  | "BOUNDED"
  | "FLAT"
  | "SAFE_AREA";

export function hasFeature(
  lens: { features?: LensFeature[] | undefined },
  feature: LensFeature,
): boolean {
  return lens.features?.includes(feature) ?? false;
}

// Chrome layout decisions derived from features + target_kind. Centralized
// so consumers (SubstrateHost, snapshot, future chrome) read one rule.
export function chromeAppliesPerspective(
  lens: { features?: LensFeature[] | undefined; target_kind: RenderTarget },
): boolean {
  if (hasFeature(lens, "BOUNDED")) return false;
  if (hasFeature(lens, "FLAT")) return false;
  return targetIsPixelSurface(lens);
}

// Chrome theme a lens contributes. Today a single `accent` color drives
// the toolbar / button / highlight family; the chrome derives tints and
// the light/dark variants. The shape is deliberately a flat extensible
// object so future lenses (universes-as-symbol, custom Memory Lenses)
// can layer in typography, glyph styles, animation tokens, etc. without
// breaking existing call sites.
export type LensTheme = {
  // Hex color (e.g. "#5cb6f2"). The chrome rewrites the --accent family
  // of CSS vars from this single value, including a darker shade for
  // light theme and a luminance-picked text color.
  accent: string;
};

// Fallback when a lens declares no theme — keeps the historical amber.
// New chrome surfaces should call getLensTheme() rather than reading
// lens.theme directly: same "ask, don't read" principle as hasFeature.
export const DEFAULT_LENS_THEME: LensTheme = { accent: "#fbbf24" };

export function getLensTheme(
  lens: { theme?: LensTheme | undefined },
): LensTheme {
  return lens.theme ?? DEFAULT_LENS_THEME;
}

export type Lens<State extends TickedState, Config, Input, CommitPayload> = {
  id: string;
  name: string;
  tunables: LensTunable[];
  speeds: SpeedOption[];
  cadence: Cadence;
  // What kind of element the lens renders into. Spec/15.
  target_kind: RenderTarget;
  // Lens-declared capability tokens. See `LensFeature` for the vocabulary.
  // Defaults to `[]` (no capabilities) when omitted — every feature
  // encodes the *non-default* state so a bare lens gets the safest
  // chrome adaptation.
  features?: LensFeature[];
  // Chrome theme — accent color etc. Chrome reads via `getLensTheme()`
  // so the default falls through cleanly when omitted. See `LensTheme`.
  theme?: LensTheme;
  // Substrate-specific named commands this lens accepts, for embed-SDK discovery
  // (spec/25). Declaration only; dispatch is `MountedLens.command`. Omit ⇒ no
  // named commands (the lens still gets the universal verbs + tunable channel).
  commands?: EmbedCommandSpec[];
  // Composite children. When present, the host mounts each layer into
  // its own sibling DOM container (z-indexed by array order: first =
  // bottom, last = top), then hands the mounted handles to this lens via
  // `LensMountArgs.children`. The host calls each child's `renderFrom`
  // directly every frame (flat iteration; visual stacking is via DOM
  // z-index, not paint order) — composing parents do NOT need to
  // dispatch rendering downward. They DO own API resolution: the root's
  // `commitGlyph` / `snapshot` / `outcomeFor` / `hudMetrics` / tunable
  // methods are free to aggregate or forward to children using the
  // handles received via mount args. Only the root drives substrate
  // ticks; children are pure views.
  layers?: ReadonlyArray<Lens<State, Config, Input, CommitPayload>>;
  mount(
    args: LensMountArgs<State, Config, Input, CommitPayload>,
  ): MountedLens<State>;
};
