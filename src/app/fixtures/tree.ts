/* Mock timeline-tree fixture — ported from design/design-spec/data.jsx.
   Replaced by real history data when the substrate wiring lands. */

import type {
  Branch,
  Commit,
  Fold,
  Params,
  Rule,
  SubstrateMeta,
} from "@/lib/types";

export const branches: Branch[] = [
  { id: "br-main",  name: "main",        lane: 2, status: "alive",     parentBranch: null,        parentCommit: null,    startTick: 0,    headTick: 3000 },
  { id: "br-diff",  name: "diffuse·low", lane: 1, status: "stale",     parentBranch: "br-main",   parentCommit: "c-m02", startTick: 200,  headTick: 1800 },
  { id: "br-burst", name: "spawn·burst", lane: 4, status: "alive",     parentBranch: "br-main",   parentCommit: "c-m06", startTick: 500,  headTick: 2700 },
  { id: "br-decay", name: "decay·fast",  lane: 0, status: "abandoned", parentBranch: "br-main",   parentCommit: "c-m11", startTick: 1200, headTick: 1900 },
  { id: "br-tuned", name: "spawn·tuned", lane: 5, status: "alive",     parentBranch: "br-burst",  parentCommit: "c-b10", startTick: 1850, headTick: 2500 },
  { id: "br-open",  name: "open·field",  lane: 3, status: "active",    parentBranch: "br-main",   parentCommit: "c-m16", startTick: 2400, headTick: 3000 },
];

export const branchById: Record<string, Branch> = Object.fromEntries(
  branches.map((b) => [b.id, b]),
);

type RawCommit = [string, string, number, string, string];
const raw: RawCommit[] = [
  // main
  ["c-m00", "br-main", 60,   "1a2b3c4", "init field 256²"],
  ["c-m01", "br-main", 140,  "8f0d12a", "seed density 0.04"],
  ["c-m02", "br-main", 200,  "c4e9077", "tune diffusion"],
  ["c-m03", "br-main", 280,  "b30a18e", "wallpaper repeat"],
  ["c-m04", "br-main", 380,  "5dd2401", "spawn rate +10%"],
  ["c-m05", "br-main", 460,  "aa18b6f", "jitter axes"],
  ["c-m06", "br-main", 500,  "7f3d29c", "kernel size up"],
  ["c-m07", "br-main", 580,  "2cb8de1", "gauss σ tweak"],
  ["c-m08", "br-main", 720,  "90a04ec", "tail decay 0.95"],
  ["c-m09", "br-main", 880,  "d0f1228", "·"],
  ["c-m10", "br-main", 1080, "ee44a02", "reseed cells"],
  ["c-m11", "br-main", 1200, "6b3c4a1", "add wall absorb"],
  ["c-m12", "br-main", 1340, "4f0aa9d", "·"],
  ["c-m13", "br-main", 1700, "a01c733", "·"],
  ["c-m14", "br-main", 1900, "38ce210", "kappa edges"],
  ["c-m15", "br-main", 2100, "f6019c0", "fix overflow"],
  ["c-m16", "br-main", 2400, "1d99e44", "open field exp"],
  ["c-m17", "br-main", 2600, "2298b08", "main steady"],
  ["c-m18", "br-main", 2800, "50aa17d", "main steady·v2"],
  // diffuse·low
  ["c-d00", "br-diff", 240,  "0a3f1c9", "σ = 0.2"],
  ["c-d01", "br-diff", 320,  "aac4001", "σ = 0.15"],
  ["c-d02", "br-diff", 420,  "88b22f4", "σ ramp"],
  ["c-d03", "br-diff", 540,  "7c0993e", "σ ramp·tuned"],
  ["c-d04", "br-diff", 680,  "40a18d2", "mass drift"],
  ["c-d05", "br-diff", 920,  "14ef206", "·"],
  ["c-d06", "br-diff", 1100, "6b09a73", "·"],
  ["c-d07", "br-diff", 1300, "ce18a09", "wall sticky"],
  ["c-d08", "br-diff", 1480, "99c00a1", "last·attempt"],
  // spawn·burst
  ["c-b00", "br-burst", 540,  "01abce4", "burst·1"],
  ["c-b01", "br-burst", 620,  "d2e5790", "burst·2"],
  ["c-b02", "br-burst", 700,  "7ac98ee", "burst·3"],
  ["c-b03", "br-burst", 800,  "3409b71", "burst rate up"],
  ["c-b04", "br-burst", 900,  "eef0a99", "phase offset"],
  ["c-b05", "br-burst", 1020, "ba12cf3", "merge·attempt"],
  ["c-b06", "br-burst", 1240, "a82d99c", "·"],
  ["c-b07", "br-burst", 1500, "0c84b15", "·"],
  ["c-b08", "br-burst", 1650, "b6f7d02", "cluster bias"],
  ["c-b09", "br-burst", 1780, "298d2a3", "spawn jitter"],
  ["c-b10", "br-burst", 1850, "74ab339", "tuned variant"],
  ["c-b11", "br-burst", 1980, "9a017bb", "continued line"],
  ["c-b12", "br-burst", 2100, "12fcde0", "continued·v2"],
  ["c-b13", "br-burst", 2280, "3aab401", "spawn cap"],
  // decay·fast (abandoned)
  ["c-x00", "br-decay", 1240, "f0a5912", "τ = 0.05"],
  ["c-x01", "br-decay", 1320, "a93c01d", "τ steeper"],
  ["c-x02", "br-decay", 1420, "38fa0ed", "overshoot"],
  ["c-x03", "br-decay", 1540, "ba4029e", "too fast"],
  ["c-x04", "br-decay", 1680, "24b1d09", "salvage·attempt"],
  ["c-x05", "br-decay", 1820, "eeb017c", "abandoned"],
  // spawn·tuned
  ["c-t00", "br-tuned", 1900, "9f12cc7", "tuned·1"],
  ["c-t01", "br-tuned", 1980, "a7d930b", "tuned·2"],
  ["c-t02", "br-tuned", 2080, "019aa2c", "lower spawn"],
  ["c-t03", "br-tuned", 2270, "50bd338", "·"],
  ["c-t04", "br-tuned", 2500, "01e2bd9", "·"],
  ["c-t05", "br-tuned", 2700, "cc81b04", "rebalance"],
  ["c-t06", "br-tuned", 2880, "7b22ff0", "tuned·current"],
  // open·field (active)
  ["c-o00", "br-open", 2440, "02f4c9a", "open·field·0"],
  ["c-o01", "br-open", 2510, "a009dbc", "wallpaper off"],
  ["c-o02", "br-open", 2580, "b1aa204", "·"],
  ["c-o03", "br-open", 2740, "4a01ce8", "·"],
  ["c-o04", "br-open", 2820, "88ff312", "disperse mode"],
  ["c-o05", "br-open", 2900, "90efa01", "spawn radius"],
  ["c-o06", "br-open", 2960, "21bc04f", "fine tune"],
  ["c-o07", "br-open", 2986, "fe091a2", "HEAD"],
];

export const commits: Commit[] = raw.map(([id, branchId, tick, hash, msg]) => ({
  id,
  branchId,
  tick,
  hash,
  msg,
}));

export const commitById: Record<string, Commit> = Object.fromEntries(
  commits.map((c) => [c.id, c]),
);

export const folds: Fold[] = [
  { id: "fold-m1", branchId: "br-main",  fromCommit: "c-m08", toCommit: "c-m10", count: 6  },
  { id: "fold-m2", branchId: "br-main",  fromCommit: "c-m12", toCommit: "c-m13", count: 12 },
  { id: "fold-d1", branchId: "br-diff",  fromCommit: "c-d04", toCommit: "c-d07", count: 9  },
  { id: "fold-b1", branchId: "br-burst", fromCommit: "c-b05", toCommit: "c-b08", count: 7  },
  { id: "fold-t1", branchId: "br-tuned", fromCommit: "c-t02", toCommit: "c-t05", count: 11 },
  { id: "fold-o1", branchId: "br-open",  fromCommit: "c-o01", toCommit: "c-o04", count: 8  },
];

export const ruleSchema: Rule[] = [
  { id: "diffusion",   group: "kernel", label: "diffusion σ",  type: "float", min: 0, max: 1,    step: 0.01,  unit: "" },
  { id: "spawnRate",   group: "spawn",  label: "spawn rate",   type: "float", min: 0, max: 0.2,  step: 0.001, unit: "/tick" },
  { id: "spawnRadius", group: "spawn",  label: "spawn radius", type: "int",   min: 1, max: 32,   step: 1,     unit: "px" },
  { id: "decayTau",    group: "decay",  label: "decay τ",      type: "float", min: 0, max: 0.5,  step: 0.005, unit: "" },
  { id: "kernelSize",  group: "kernel", label: "kernel size",  type: "int",   min: 3, max: 21,   step: 2,     unit: "px" },
  { id: "wallAbsorb",  group: "bounds", label: "wall absorb",  type: "bool" },
  { id: "wrap",        group: "bounds", label: "wrap edges",   type: "bool" },
  { id: "jitter",      group: "kernel", label: "jitter axes",  type: "enum", options: ["off", "x", "y", "xy"] },
];

export const headParams: Params = {
  diffusion: 0.18,
  spawnRate: 0.062,
  spawnRadius: 11,
  decayTau: 0.032,
  kernelSize: 9,
  wallAbsorb: false,
  wrap: false,
  jitter: "xy",
};

export const parentParams: Params = {
  diffusion: 0.18,
  spawnRate: 0.045,
  spawnRadius: 7,
  decayTau: 0.05,
  kernelSize: 9,
  wallAbsorb: true,
  wrap: true,
  jitter: "xy",
};

export const tickRange: [number, number] = [0, 3000];

export const substrates: SubstrateMeta[] = [
  {
    id: "conway",
    name: "conway",
    desc: "cell evolution",
    speeds: [
      { id: "1_16", label: "×1/16", mult: 0.0625 },
      { id: "1_8",  label: "×1/8",  mult: 0.125 },
      { id: "1_4",  label: "×1/4",  mult: 0.25 },
      { id: "1_2",  label: "×1/2",  mult: 0.5 },
      { id: "1",    label: "×1",    mult: 1, isDefault: true },
      { id: "2",    label: "×2",    mult: 2 },
      { id: "4",    label: "×4",    mult: 4 },
      { id: "8",    label: "×8",    mult: 8 },
      { id: "16",   label: "×16",   mult: 16 },
    ],
  },
  {
    id: "reactdiff",
    name: "reaction·diff",
    desc: "gray-scott family",
    speeds: [
      { id: "glacial", label: "glacial", mult: 0.1 },
      { id: "creep",   label: "creep",   mult: 0.5 },
      { id: "cruise",  label: "cruise",  mult: 1, isDefault: true },
      { id: "sprint",  label: "sprint",  mult: 2 },
      { id: "warp",    label: "warp",    mult: 5 },
    ],
  },
  {
    id: "flocks",
    name: "flocks",
    desc: "boids on torus",
    speeds: [
      { id: "idle",   label: "idle",   mult: 0.25 },
      { id: "slow",   label: "slow",   mult: 0.5 },
      { id: "live",   label: "live",   mult: 1, isDefault: true },
      { id: "rush",   label: "rush",   mult: 2 },
      { id: "frenzy", label: "frenzy", mult: 4 },
    ],
  },
  {
    id: "lattice",
    name: "lattice·gas",
    desc: "fhp on hex grid",
    speeds: [
      { id: "1t", label: "1 tick/frame",  mult: 1, isDefault: true },
      { id: "2t", label: "2 ticks/frame", mult: 2 },
      { id: "4t", label: "4 ticks/frame", mult: 4 },
      { id: "8t", label: "8 ticks/frame", mult: 8 },
    ],
  },
];

export const HEAD_COMMIT_ID = "c-o07";
export const ACTIVE_BRANCH_ID = "br-open";
export const DEFAULT_RUN_NAME = "open-field-disperse-spawn";
