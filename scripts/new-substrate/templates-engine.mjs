/* Per-answer templates for the engine/ subdir. Each returns the file
 * content for ctx = { forms, answers }, or null to opt the file out (e.g.
 * channels.ts when storage=plain). Files no answer affects (config.ts,
 * level.ts) have no template here and fall back to the renamed example.
 *
 * Every output is a compiling no-op stub — the author fills the real
 * physics. They are written to read like the hand-authored substrates
 * (example / tron) so the generated package is a teaching artifact, not a
 * black box. */

const heldHeading = (a) => a.agency === "held";

// engine/types.ts — State shape (Q3) + Inputs union (Q4).
export function typesTs({ forms: F, answers: A }) {
  const stateField =
    A.storage === "channels"
      ? "  field: Float32Array;   // per-cell channel (doubled). Rename / add channels for the real state.\n"
      : "  count: number;         // plain scalar state. Replace with the real fields.\n";

  let inputs;
  if (A.agency === "none") {
    inputs = `// Autonomous world — the player only observes, so there is no input.\nexport type ${F.pascal}Inputs = Record<string, never>;`;
  } else if (A.agency === "held") {
    inputs =
      `export type Heading = "up" | "down" | "left" | "right";\n\n` +
      `// Continuous / held input — the lens samples the held heading every\n` +
      `// tick (attachKeyControls). "none" = nothing held.\n` +
      `export type ${F.pascal}Inputs = { desired: Heading | "none" };`;
  } else if (A.agency === "discrete") {
    inputs =
      `// Discrete event — one action per gesture (a click / key press).\n` +
      `export type ${F.pascal}Inputs = { action: { kind: "act"; x: number; y: number } | null };`;
  } else {
    inputs =
      `// Spatial stamp — one cell edit per accepted pointer sample (attachBrush).\n` +
      `export type ${F.pascal}Inputs = { stamp: { x: number; y: number } | null };`;
  }

  return `// ${F.title} substrate state. Generated stub — replace the placeholder
// fields with the substrate's real state. The struct is named
// \`SubstrateState\` locally (cross-package callers refer to it through the
// package).
export type SubstrateState = {
  W: number;
  H: number;
${stateField}  tick: number;
};

// Per-tick injected input — the player's entire action surface (Q4).
${inputs}
`;
}

// engine/channels.ts — only when storage=channels.
export function channelsTs({ forms: F, answers: A }) {
  if (A.storage !== "channels") return null;
  return `import type { ChannelDescriptor } from "@/engine/channels";
import type { ${F.pascal}Config } from "./config";

// Declare every typed-array channel the substrate needs. Stub: one doubled
// per-cell field — add the real channels.
export function buildChannels(config: ${F.pascal}Config): ChannelDescriptor[] {
  const F = config.W * config.H;
  return [{ name: "field", type: "Float32Array", size: F, doubled: true }];
}
`;
}

// engine/state.ts — channel wiring vs plain alloc (Q3).
export function stateTs({ forms: F, answers: A }) {
  if (A.storage === "channels") {
    return `import type { ChannelBag } from "@/engine/channels";
import type { ${F.pascal}Config } from "./config";
import type { SubstrateState } from "./types";

// Wire the engine-allocated channel bag into the typed state struct.
export function makeState(bag: ChannelBag, config: ${F.pascal}Config): SubstrateState {
  const field = bag.field;
  if (!(field instanceof Float32Array)) {
    throw new Error("channel 'field' missing or not Float32Array");
  }
  return { W: config.W, H: config.H, field, tick: 0 };
}

// Populate shared/immutable channels once. Stub: nothing to bake yet.
export function initState(_state: SubstrateState, _config: ${F.pascal}Config): void {
  // intentionally empty
}
`;
  }
  return `import type { ${F.pascal}Config } from "./config";
import type { SubstrateState } from "./types";

// Plain-object alloc — no channels. Called once per buffer (read + write).
export function makeState(config: ${F.pascal}Config): SubstrateState {
  return { W: config.W, H: config.H, count: 0, tick: 0 };
}

// One-time init on the read buffer. Stub: nothing to seed yet.
export function initState(_state: SubstrateState, _config: ${F.pascal}Config): void {
  // intentionally empty
}
`;
}

// engine/tick.ts — carry state forward (Q3) + consume input (Q4). The
// determinism callout: stochastic ticks thread `rng` (no Math.random) — the
// stub returns it untouched.
export function tickTs({ forms: F, answers: A }) {
  const carry =
    A.storage === "channels"
      ? "  w.field.set(r.field); // carry the field forward; mutate w for real dynamics"
      : "  w.count = r.count;    // carry plain state forward";

  let inputParam = "_inputs";
  let consume = "";
  if (A.agency === "held") {
    inputParam = "inputs";
    consume = "\n  // TODO: steer using the held heading.\n  void inputs.desired;";
  } else if (A.agency === "discrete") {
    inputParam = "inputs";
    consume = "\n  // TODO: apply the discrete action when present.\n  void inputs.action;";
  } else if (A.agency === "stamp") {
    inputParam = "inputs";
    consume = "\n  // TODO: write the stamped cell when present.\n  void inputs.stamp;";
  }

  return `import type { ${F.pascal}Config } from "./config";
import type { RNGState } from "@/engine/types";
import type { ${F.pascal}Inputs, SubstrateState } from "./types";

// No-op tick: advances the counter and carries state forward. Replace with
// the substrate's real (State, Causality) → State step. If it becomes
// stochastic, thread \`rng\` (no Math.random) so replay/branch stay exact.
export function tick${F.pascal}(
  r: SubstrateState,
  w: SubstrateState,
  _config: ${F.pascal}Config,
  rng: RNGState,
  ${inputParam}: ${F.pascal}Inputs,
): RNGState {
  w.W = r.W;
  w.H = r.H;
  w.tick = r.tick + 1;
${carry}${consume}
  return rng;
}
`;
}

// engine/bttf-adapter.ts — commit cadence (Q6).
export function bttfTs({ forms: F, answers: A }) {
  let predicate;
  if (A.commit === "per-tick") {
    predicate = `  commit_predicate: (_before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    if (after.tick % COMMIT_PERIOD !== 0) return null; // rate-limit
    return snapshot${F.pascal}(after);
  },`;
  } else if (A.commit === "per-event") {
    predicate = `  commit_predicate: (before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    // TODO: emit only on a meaningful change. Stub: every tick advance.
    if (after.tick === before.tick) return null;
    return snapshot${F.pascal}(after);
  },`;
  } else {
    predicate = `  commit_predicate: (_before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    // Per-input: every accepted input drives a tick → commit it.
    return snapshot${F.pascal}(after);
  },`;
  }

  return `// ${F.title}'s BTTF contract. Per-tick *inputs* are recorded by historyTick
// regardless; this predicate governs commit (timeline node) density.
import type { HistoryAdapter } from "@/history/types";
import type { ${F.pascal}Inputs, SubstrateState } from "./types";

export const COMMIT_PERIOD = 50;

export type ${F.pascal}CommitPayload = {
  tick: number;
};

export function snapshot${F.pascal}(s: SubstrateState): ${F.pascal}CommitPayload {
  return { tick: s.tick };
}

export const ${F.camel}BttfAdapter: HistoryAdapter<
  SubstrateState,
  ${F.pascal}Inputs,
  ${F.pascal}CommitPayload
> = {
  root_commit: (s) => snapshot${F.pascal}(s),
${predicate}
};
`;
}

// engine/index.ts — the subdir barrel + bundle (Q3 picks the alloc).
export function engineIndexTs({ forms: F, answers: A }) {
  const channels = A.storage === "channels";
  const headingExport = heldHeading(A) ? ", Heading" : "";

  const channelImports = channels
    ? `import { channelAlloc } from "@/engine/channels";\nimport { buildChannels } from "./channels";\n`
    : "";
  const alloc = channels
    ? "  alloc: channelAlloc(buildChannels, makeState),"
    : `  alloc: (config: ${F.pascal}Config) => ({ read: makeState(config), write: makeState(config) }),`;

  return `// ${F.title} substrate package — engine subdir barrel.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
${channelImports}import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { initState, makeState } from "./state";
import { tick${F.pascal} } from "./tick";
import type { ${F.pascal}Config } from "./config";
import type { ${F.pascal}Inputs, SubstrateState } from "./types";

export const ${F.camel}Bundle: SubstrateBundle<SubstrateState, ${F.pascal}Config, ${F.pascal}Inputs> = {
${alloc}
  initState,
  tick: tick${F.pascal},
};

export function allocSubstrate(config: ${F.pascal}Config): Substrate<SubstrateState> {
  return engineAlloc(${F.camel}Bundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: ${F.pascal}Config,
  rng: RNGState,
  inputs: ${F.pascal}Inputs,
): RNGState {
  return engineTick(${F.camel}Bundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile } from "./level";
export {
  COMMIT_PERIOD,
  ${F.camel}BttfAdapter,
  snapshot${F.pascal},
  type ${F.pascal}CommitPayload,
} from "./bttf-adapter";
export type { ${F.pascal}Config };
export type { SubstrateState, ${F.pascal}Inputs${headingExport} } from "./types";
`;
}
