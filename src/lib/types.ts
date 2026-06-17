/* Spec §2 — data model for the BTTF timeline-tree. */

export type BranchStatus = "active" | "alive" | "stale" | "abandoned";

export type Branch = {
  id: string;
  name: string;
  lane: number;
  status: BranchStatus;
  parentBranch: string | null;
  parentCommit: string | null;
  startTick: number;
  headTick: number;
};

export type Params = Record<string, number | boolean | string>;

export type Commit = {
  id: string;
  branchId: string;
  tick: number;
  hash: string;
  msg: string;
  parentCommitId?: string;
  params?: Params;
  // True when the underlying commit carries a retained child history
  // (`Commit.inner`) — a resolve commit you can drill into.
  // The chrome surfaces a descend affordance on these.
  hasInner?: boolean;
};

export type Fold = {
  id: string;
  branchId: string;
  fromCommit: string;
  toCommit: string;
  count: number;
};

/* Spec §3 — substrate contract surface. */
export type SpeedOption = {
  id: string;
  label: string;
  mult: number;
  isDefault?: boolean;
};

export type Rule =
  | {
      id: string;
      group: string;
      label: string;
      type: "float";
      min: number;
      max: number;
      step: number;
      /** Optional non-linear slider mapping. `"signed-cubic"` gives finer
       *  granularity near zero on symmetric ranges (slider position
       *  `t∈[−1,+1]` maps to value `sign(t) * M * |t|^3` where `M =
       *  max(|min|, |max|)`). Default `"linear"`. */
      curve?: "linear" | "signed-cubic";
      unit?: string;
    }
  | {
      id: string;
      group: string;
      label: string;
      type: "int";
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | { id: string; group: string; label: string; type: "bool" }
  | {
      id: string;
      group: string;
      label: string;
      type: "enum";
      options: string[];
      /** How the chrome paints the choice. `"segmented"` (default) is a
       *  horizontal button group — good for 2–3 short options. `"list"` is a
       *  vertical stack of full-width clickable rows — for many or
       *  long-labelled options (e.g. a paged manual's page selector). */
      display?: "segmented" | "list";
    };

export type SubstrateMeta = {
  id: string;
  name: string;
  desc: string;
  speeds: SpeedOption[];
};
