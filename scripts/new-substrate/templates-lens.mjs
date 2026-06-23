/* Per-answer templates for the lens/ subdir — the crux of v1, where the
 * Agency answer (Q4) finally scaffolds real input wiring. Render target
 * (Q1), viewport features (Q2), agency (Q4), pace (Q5), and commit (Q6) all
 * shape the output. Every combination is a compiling no-op-but-green lens.
 *
 * Generated code uses string concatenation (not template literals) so this
 * builder needs no backtick escaping. */

const ACCENT = "#7dd3fc";
const CELL_PX = 16;

// lens/render.ts — Q1 render target.
export function renderTs({ forms: F, answers: A }) {
  if (A.render === "ascii") {
    return `import type { SubstrateState } from "../engine";

// ASCII render — return the text the lens writes into its <pre>.
export function render${F.pascal}Text(state: SubstrateState): string {
  return "${F.title} — tick " + state.tick + "  (" + state.W + "x" + state.H + ")";
}
`;
  }
  if (A.render === "dom") {
    return `import type { SubstrateState } from "../engine";

// DOM render — return the text/markup the lens writes into its <div>.
export function render${F.pascal}Dom(state: SubstrateState): string {
  return "${F.title} — tick " + state.tick;
}
`;
  }
  if (A.render === "webgl") {
    return `import type { SubstrateState } from "../engine";

// WebGL render — clear the framebuffer to the background each frame. An
// honest no-op-but-green stub: it draws nothing yet, but it is real GL (it
// matches the lens's target_kind: "webgl", unlike a 2D fallback). To draw the
// substrate, reach for the gl kit: createShader + createInstancedQuads
// for cells/sprites, createTexture + createFullScreenPass for fields. \`state\`
// is threaded through so the real draw already has it.
export function draw${F.pascal}Frame(
  state: SubstrateState,
  gl: WebGL2RenderingContext,
  opts: { width: number; height: number },
): void {
  void state;
  gl.viewport(0, 0, opts.width, opts.height);
  gl.clearColor(0.043, 0.051, 0.071, 1); // #0b0d12
  gl.clear(gl.COLOR_BUFFER_BIT);
}
`;
  }
  // canvas2d
  return `import type { SubstrateState } from "../engine";

const COLOR_BG = "#0b0d12";

// Canvas render — draw one frame of the substrate. Stub: background + tick.
export function draw${F.pascal}Frame(
  state: SubstrateState,
  ctx: CanvasRenderingContext2D,
  opts: { cell_px: number },
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(125, 211, 252, 0.85)";
  ctx.font = "12px 'Geist Mono', monospace";
  ctx.fillText("tick " + state.tick, opts.cell_px, opts.cell_px + 4);
}
`;
}

// lens/index.ts — Q1 + Q2 + Q4 + Q5 + Q6.
export function lensIndexTs({ forms: F, answers: A }) {
  const P = F.pascal;
  const isCanvas = A.render === "canvas2d" || A.render === "webgl";
  const isWebgl = A.render === "webgl";
  const isCanvas2d = A.render === "canvas2d";
  const isAscii = A.render === "ascii";
  const autonomous = A.pace === "autonomous";
  const renderOnly = A.pace === "render-only";
  const eventDriven = A.pace === "event-driven";
  const held = A.agency === "held";
  const stamp = A.agency === "stamp";
  const discrete = A.agency === "discrete";
  const safeArea = A.viewport === "safe-area";
  const targetKind = A.render;
  // history is referenced by the autonomous tick driver and by input
  // handlers that drive ticks; otherwise it's unused in the stub.
  const historyUsed = autonomous || (eventDriven && (discrete || stamp));

  // The neutral per-tick input for this agency (also the replay fallback).
  const neutral = held
    ? "{ desired: keys.next() }"
    : discrete
      ? "{ action: null }"
      : stamp
        ? "{ stamp: null }"
        : "{}";

  // --- imports ---
  // The lens reaches the host only through `args.host` (the injected
  // LensHost) — never `@/app/store`, which would break the embed/bare/
  // headless hosts. "Ask, don't read." (spec/13)
  const imp = [];
  if (autonomous) imp.push(`import { historyAdvance, historyTick } from "@/history";`);
  else if (eventDriven && (discrete || stamp)) imp.push(`import { historyTick } from "@/history";`);
  const engineTypes = ["SubstrateState", `${P}CommitPayload`, `${P}Config`, `${P}Inputs`];
  if (held) engineTypes.push("Heading");
  imp.push(`import type { ${engineTypes.join(", ")} } from "../engine";`);
  if (autonomous) imp.push(`import { COMMIT_PERIOD } from "../engine";`);
  imp.push(`import type { Params, SpeedOption } from "@/lib/types";`);
  if (isCanvas) imp.push(`import { attachCanvasSizing } from "@/lib/canvas/sizing";`);
  if (isWebgl) imp.push(`import { createGLContext } from "@/lib/gl";`);
  if (held) imp.push(`import { attachKeyControls } from "@/lib/canvas/key-controls";`);
  if (stamp && isCanvas) imp.push(`import { attachBrush } from "@/lib/canvas/brush";`);
  const lensTypes = ["Cadence", "CommitGlyph", "Lens", "LensMountArgs", "LensTunable", "MountedLens", "TunableValue"];
  if (safeArea) lensTypes.push("ViewportInset");
  imp.push(`import type {\n  ${lensTypes.join(",\n  ")},\n} from "@/lenses/types";`);
  if (isCanvas) imp.push(`import { draw${P}Frame } from "./render";`);
  else if (isAscii) imp.push(`import { render${P}Text } from "./render";`);
  else imp.push(`import { render${P}Dom } from "./render";`);

  // --- features ---
  const feats = [];
  if (autonomous || renderOnly) feats.push(`"AUTOPLAY"`);
  if (A.viewport === "flat") feats.push(`"FLAT"`);
  else if (A.viewport === "bounded") feats.push(`"BOUNDED"`);
  else if (A.viewport === "safe-area") feats.push(`"SAFE_AREA"`);
  if (A.agency === "none") feats.push(`"SINGLE_BRANCH"`);

  // --- container setup ---
  let container;
  if (isWebgl) {
    container =
      `  const canvas = document.createElement("canvas");\n` +
      `  canvas.style.width = "100%";\n` +
      `  canvas.style.height = "100%";\n` +
      `  canvas.style.display = "block";\n` +
      `  container.appendChild(canvas);\n` +
      `  // Q1 webgl: the gl kit owns context acquisition + loss handling.\n` +
      `  const glctx = createGLContext(canvas);\n`;
  } else if (isCanvas2d) {
    container =
      `  const canvas = document.createElement("canvas");\n` +
      `  canvas.style.width = "100%";\n` +
      `  canvas.style.height = "100%";\n` +
      `  canvas.style.display = "block";\n` +
      `  container.appendChild(canvas);\n` +
      `  const ctx = canvas.getContext("2d");\n` +
      `  if (!ctx) throw new Error("could not acquire 2d context");\n`;
  } else if (isAscii) {
    container =
      `  const pre = document.createElement("pre");\n` +
      `  pre.style.margin = "0";\n` +
      `  container.appendChild(pre);\n`;
  } else {
    container = `  const root = document.createElement("div");\n  container.appendChild(root);\n`;
  }

  // --- sizing / safe-area ---
  let sizing = isCanvas ? `\n  const sizing = attachCanvasSizing(canvas, { onResize: () => {} });\n` : "";
  let safe = safeArea
    ? `\n  // SAFE_AREA: place any in-canvas HUD inside this inset.\n` +
      `  let inset: ViewportInset = { top: 16, right: 16, bottom: 16, left: 16 };\n` +
      `  const unsubscribeViewport = args.subscribeViewport((i) => { inset = i; });\n` +
      `  void inset;\n`
    : "";

  // --- input wiring (Q4) ---
  let input = "";
  if (held) {
    input =
      `\n  // Q4 held: arrows / WASD set a held heading sampled each tick.\n` +
      `  const KEYMAP: Record<string, Heading> = {\n` +
      `    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",\n` +
      `    w: "up", s: "down", a: "left", d: "right",\n` +
      `  };\n` +
      `  const keys = attachKeyControls<Heading | "none">({ keymap: KEYMAP, neutral: "none", bufferMs: 200 });\n`;
  } else if (stamp && isCanvas) {
    const drive = eventDriven
      ? `      historyTick(history, { stamp: { x: s.cell_x, y: s.cell_y } });\n` +
        `      host.setPlayheadTick(history.substrate.read.tick);\n` +
        `      host.bumpHistoryVersion();\n`
      : `      void s; // TODO (autonomous pace): stash the stamp for the next tick.\n`;
    input =
      `\n  // Q4 stamp: a held pointer streams cell edits (attachBrush).\n` +
      `  const brush = attachBrush({\n` +
      `    canvas,\n` +
      `    projectCell: (cx, cy) => {\n` +
      `      const r = canvas.getBoundingClientRect();\n` +
      `      return { kind: "on_patch", cell_x: Math.floor((cx - r.left) / CELL_PX), cell_y: Math.floor((cy - r.top) / CELL_PX) };\n` +
      `    },\n` +
      `    onStamp: (s) => {\n${drive}    },\n` +
      `  });\n`;
  } else if (stamp) {
    input = `\n  // Q4 stamp needs a canvas; switch render to canvas2d, then wire attachBrush.\n`;
  } else if (discrete) {
    const drive = eventDriven
      ? `    historyTick(history, { action: { kind: "act", x: 0, y: 0 } });\n` +
        `    host.setPlayheadTick(history.substrate.read.tick);\n` +
        `    host.bumpHistoryVersion();\n`
      : `    // TODO (autonomous pace): queue the action for the next tick.\n`;
    input =
      `\n  // Q4 discrete: one action per click.\n` +
      `  function onClick(e: MouseEvent): void {\n    void e;\n${drive}  }\n` +
      `  container.addEventListener("click", onClick);\n`;
  }

  // --- pace / tick driver (Q5) ---
  const CELL = `\nconst CELL_PX = ${CELL_PX};\n`;
  let driver = `\n  let speed_mult = 1;\n`;
  if (autonomous) {
    driver +=
      `\n  // Q5 autonomous: the host owns the rAF and drives doOneTick. At the\n` +
      `  // live head we sample the current input; scrubbed behind it we replay\n` +
      `  // the recorded input so a scrub-then-play stays bit-exact.\n` +
      `  function doOneTick(): void {\n` +
      `    const active = history.branches[history.active]!;\n` +
      `    const cur = history.substrate.read.tick;\n` +
      `    if (cur < active.head_tick) {\n` +
      `      const entry = active.inputs.find((e) => e.tick === cur + 1);\n` +
      `      historyAdvance(history, entry ? entry.input : ${neutral});\n` +
      `      host.setPlayheadTick(history.substrate.read.tick);\n` +
      `      return;\n` +
      `    }\n` +
      `    historyTick(history, ${neutral});\n` +
      `    const st = history.substrate.read;\n` +
      `    host.setPlayheadTick(st.tick);\n` +
      `    if (st.tick % COMMIT_PERIOD === 0) host.bumpHistoryVersion();\n` +
      `  }\n`;
  }

  // --- renderFrom ---
  const renderBody = isWebgl
    ? `    draw${P}Frame(state, glctx.gl, { width: canvas.width, height: canvas.height });`
    : isCanvas2d
    ? `    draw${P}Frame(state, ctx as CanvasRenderingContext2D, { cell_px: CELL_PX });`
    : isAscii
      ? `    pre.textContent = render${P}Text(state);`
      : `    root.textContent = render${P}Dom(state);`;

  // --- unmount detaches ---
  const detaches = [];
  if (isCanvas) detaches.push("      sizing.detach();");
  if (isWebgl) detaches.push("      glctx.destroy();");
  if (held) detaches.push("      keys.detach();");
  if (stamp && isCanvas) detaches.push("      brush.detach();");
  if (discrete) detaches.push(`      container.removeEventListener("click", onClick);`);
  if (safeArea) detaches.push("      unsubscribeViewport();");
  const removeEl = isCanvas
    ? "      if (canvas.parentNode === container) container.removeChild(canvas);"
    : isAscii
      ? "      if (pre.parentNode === container) container.removeChild(pre);"
      : "      if (root.parentNode === container) container.removeChild(root);";

  // --- MountedLens return ---
  const ret = [];
  ret.push("    unmount: () => {");
  for (const d of detaches) ret.push(d);
  ret.push(removeEl);
  ret.push("    },");
  ret.push("    renderFrom,");
  if (autonomous) {
    ret.push("    tick: doOneTick,");
    ret.push("    speedMult: () => speed_mult,");
  }
  if (isCanvas) ret.push("    snapshot: () => canvas,");
  ret.push("    commitGlyph,");
  ret.push("    pause: () => { host.setPlaying(false); },");
  ret.push("    resume: () => { host.setPlaying(true); },");
  ret.push(
    "    step: () => { host.setPlaying(false);" + (autonomous ? " doOneTick();" : "") + " },",
  );
  ret.push("    setSpeed: (id: string) => { const o = SPEEDS.find((s) => s.id === id); if (o) speed_mult = o.mult; },");
  ret.push("    getTunable: () => undefined,");
  ret.push("    setTunable: () => {},");
  ret.push("    subscribeTunables: () => () => {},");

  return `/* ${F.title} lens. Generated stub — walk the six design questions in
 * docs/guide.md and fill the real render + input. */

${imp.join("\n")}

const ACCENT = "${ACCENT}";
${CELL}
const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1, isDefault: true },
  { id: "2x", label: "2x", mult: 2 },
  { id: "4x", label: "4x", mult: 4 },
];

const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [];

function mount${P}(
  args: LensMountArgs<SubstrateState, ${P}Config, ${P}Inputs, ${P}CommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;${historyUsed ? "" : "\n  void history;"}

${container}${sizing}${safe}${input}${driver}
  function renderFrom(state: SubstrateState): void {
${renderBody}
  }

  function commitGlyph(_payload: Params): CommitGlyph {
    return { kind: "disc", color: ACCENT };
  }

  return {
${ret.join("\n")}
  };
}

export const ${F.camel}Lens: Lens<
  SubstrateState,
  ${P}Config,
  ${P}Inputs,
  ${P}CommitPayload
> = {
  id: "${F.kebab}-grid",
  name: "Grid",
  tunables: TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "${targetKind}",
  features: [${feats.join(", ")}],
  theme: { accent: ACCENT },
  mount: mount${P},
};
`;
}
