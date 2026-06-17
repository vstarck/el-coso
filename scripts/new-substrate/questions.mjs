/* The question manifest — the single source of truth for the six substrate
 * design questions. It drives THREE things, which is the whole point:
 *
 *   1. the wizard prompts (cli.mjs reads title / prompt / options),
 *   2. the per-answer template toggles (templates/*.mjs switch on the
 *      chosen option `value`s),
 *   3. the human-prose authoring-doc mirror (the doc-sync test asserts
 *      every option's `match` string is present in the doc).
 *
 * Because all three read this one array, the wizard, the generated code,
 * and the docs cannot drift. Adding or renaming an option here forces the
 * matching doc edit (or the sync test fails) and is the only place a
 * template's switch values are defined.
 *
 * (The design said
 * `questions.ts`; this is `.mjs` so the toolchain needs no TS runner —
 * same single-source-of-truth role.)
 */

export const QUESTIONS = [
  {
    id: "render",
    docQ: "Q1",
    title: "Render target",
    prompt: "What does the substrate render onto?",
    options: [
      { value: "canvas2d", label: "Canvas 2D", hint: "most substrates", match: "Canvas 2D" },
      { value: "ascii", label: "ASCII", hint: "text grid, like blockoide's well", match: "ASCII" },
      { value: "dom", label: "DOM", hint: "plain <div>/<button> elements", match: "DOM" },
      { value: "webgl", label: "WebGL2", hint: "gl kit — generates a clear-only GL stub to fill in", match: "WebGL2" },
    ],
  },
  {
    id: "viewport",
    docQ: "Q2",
    title: "Viewport relation",
    prompt: "How does the viewport relate to the world?",
    options: [
      { value: "full-bleed", label: "Full-bleed, perspective-tilted", hint: "the default", match: "perspective-tilted" },
      { value: "flat", label: "Full-bleed, flat (lens owns projection)", hint: "FLAT", match: "FLAT" },
      { value: "bounded", label: "Bounded (lens sizes its own host)", hint: "BOUNDED", match: "BOUNDED" },
      { value: "safe-area", label: "Full-bleed with in-canvas HUD", hint: "SAFE_AREA", match: "SAFE_AREA" },
    ],
  },
  {
    id: "storage",
    docQ: "Q3",
    title: "Storage shape",
    prompt: "How is the substrate's state stored?",
    options: [
      { value: "channels", label: "Dense / hot-path (typed-array channels)", hint: "channelAlloc", match: "ChannelDescriptor" },
      { value: "plain", label: "Sparse / event-driven (plain objects)", hint: "skip channels.ts", match: "plain objects" },
    ],
  },
  {
    id: "agency",
    docQ: "Q4",
    title: "Agency (how the player acts)",
    prompt: "How does the player act on the substrate?",
    options: [
      { value: "none", label: "None — autonomous world, observe only", hint: "Inputs = {}", match: "the player only" },
      { value: "held", label: "Continuous / held heading or vector", hint: "attachKeyControls", match: "attachKeyControls" },
      { value: "discrete", label: "Discrete event — one action per gesture", hint: "click / keydown", match: "Discrete event" },
      { value: "stamp", label: "Spatial stamp — cells under a held pointer", hint: "attachBrush", match: "attachBrush" },
    ],
  },
  {
    id: "pace",
    docQ: "Q5",
    title: "Substrate pace",
    prompt: "How does the substrate advance?",
    options: [
      { value: "autonomous", label: "Autonomous — rAF drives ticks", hint: "tick + speedMult, AUTOPLAY", match: "Autonomous" },
      { value: "render-only", label: "Render-only — animates, never ticks here", hint: "omit tick", match: "Render-only" },
      { value: "event-driven", label: "Event-driven — advance on input", hint: "historyTick from handlers", match: "Event-driven" },
    ],
  },
  {
    id: "commit",
    docQ: "Q6",
    title: "Commit shape",
    prompt: "When does a commit land on the timeline?",
    options: [
      { value: "per-tick", label: "Per-tick (rate-limited every N)", hint: "COMMIT_PERIOD", match: "Per-tick" },
      { value: "per-event", label: "Per-event (meaningful state change)", hint: "directional input, pulse", match: "Per-event" },
      { value: "per-input", label: "Per-input (every accepted input)", hint: "one commit per action", match: "Per-input" },
    ],
  },
];

// The example template's own answer profile — v0 / the fallback files
// embody exactly this. Useful as a default and as a rot-test baseline.
export const EXAMPLE_PROFILE = {
  render: "canvas2d",
  viewport: "safe-area",
  storage: "channels",
  agency: "none",
  pace: "autonomous",
  commit: "per-tick",
};

// Validate an answers object against the manifest: every question answered
// with one of its option values. Returns an error string or null.
export function validateAnswers(answers) {
  for (const q of QUESTIONS) {
    const v = answers[q.id];
    if (v === undefined) return `missing answer for "${q.id}"`;
    if (!q.options.some((o) => o.value === v)) {
      return `invalid value "${v}" for "${q.id}" (expected one of ${q.options.map((o) => o.value).join(", ")})`;
    }
  }
  return null;
}
