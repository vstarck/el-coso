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

/** What every rule carries, whatever its type.
 *
 *  ⚠ EXTRACTED, rather than adding `public` to four object literals. Four copies of
 *  `id`/`group`/`label` were already three copies too many, and the failure mode of the
 *  duplicated form is silent: a field added to three of the four members type-checks
 *  everywhere and is simply absent for whichever kind was missed. */
type RuleCommon = {
  id: string;
  group: string;
  label: string;
  /** Whether this knob belongs on a PUBLIC surface — a post, an embed in a page —
   *  as opposed to the studio, which shows everything.
   *
   *  ⚠ ABSENT MEANS NOT PUBLIC. A knob reaches a public surface only by saying so,
   *  because the failure mode of the other default is a knob appearing in front of
   *  visitors because someone forgot a field. The studio rail ignores this entirely;
   *  it is the embed manifest (`TunableManifest.public`) that carries it to a host.
   *
   *  ⚠ THIS IS A FLAG, NOT A DESCRIPTION. There is deliberately no `desc` beside it:
   *  a knob's user-facing text lives in the substrate's own `tunables.md`, where a
   *  host can take a suggested tooltip or write its own. A string in this type would
   *  be shipped data — minified into every bundle whether or not anything renders it —
   *  and the substrate's documentation is the better owner of prose that changes. */
  public?: boolean;
};

export type Rule =
  | (RuleCommon & {
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
    })
  | (RuleCommon & {
      type: "int";
      min: number;
      max: number;
      step: number;
      unit?: string;
    })
  | (RuleCommon & { type: "bool" })
  | (RuleCommon & {
      type: "enum";
      options: string[];
      /** The subset of `options` a PUBLIC surface should offer — `RuleCommon.public`
       *  one level down. `public` says whether the knob belongs on a public surface at
       *  all; this says which of its choices do, for an enum whose options are not
       *  uniformly public (`preset`: some saved worlds are labs-only).
       *
       *  ⚠ A HINT, NOT A FILTER. `options` stays the complete, authoritative set and
       *  remains what a value is validated against, so every option is still settable
       *  by id from a console or a labs page. Absent ⇒ "this lens does not say", which
       *  a host must read as "offer them all" — the behaviour before this field
       *  existed. Filtering `options` itself would make a labs world unreachable
       *  rather than unadvertised, which is a removal wearing the word "hint". */
      public_options?: string[];
      /** How the chrome paints the choice. `"segmented"` (default) is a
       *  horizontal button group — good for 2–3 short options. `"list"` is a
       *  vertical stack of full-width clickable rows — for many or
       *  long-labelled options (e.g. a paged manual's page selector). */
      display?: "segmented" | "list";
    });

export type SubstrateMeta = {
  id: string;
  name: string;
  desc: string;
  speeds: SpeedOption[];
};
