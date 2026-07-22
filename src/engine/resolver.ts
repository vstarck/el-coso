// Resolver seam (spec/27). Every nondeterministic outcome a substrate mints
// goes through one injected `resolve(tag, opts?)` whose backing — threaded
// RNG, recorded transcript, injected entropy — is the driver's choice and
// opaque to the substrate. This file is the single owner of the fold/shape
// logic: the backing only supplies uniforms, the substrate never sees them.
//
// Platform-agnostic: no DOM, no Node APIs, no Date/Math.random. All impurity
// enters through the injected `draw` (entropy backing), constructed at
// app/dev tier only.

import { nextUniform, shapeNormal, shapeRange } from "./rng";
import type {
  ResolutionKind,
  ResolutionRecord,
  Resolve,
  ResolveOpts,
  RNGState,
} from "./types";

// --- opts validation -------------------------------------------------------

type ParsedOpts =
  | { kind: "u" }
  | { kind: "index"; weights: number[] }
  | { kind: "range"; lo: number; hi: number }
  | { kind: "normal" };

// Validates a call's opts and resolves the draw kind. Throws (never-silent)
// on every malformed shape — two kinds at once, bad arity/range/weights.
function parseOpts(tag: string, opts?: ResolveOpts): ParsedOpts {
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error("resolve: tag must be a non-empty string");
  }
  if (opts === undefined) return { kind: "u" };

  const kinds: string[] = [];
  if (opts.weights !== undefined) kinds.push("weights");
  if (opts.arity !== undefined) kinds.push("arity");
  if (opts.range !== undefined) kinds.push("range");
  if (opts.normal !== undefined) kinds.push("normal");
  if (kinds.length > 1) {
    throw new Error(`resolve(${tag}): at most one draw kind, got ${kinds.join("+")}`);
  }

  if (opts.weights !== undefined) {
    const w = opts.weights;
    if (w.length === 0) throw new Error(`resolve(${tag}): weights must be non-empty`);
    let sum = 0;
    for (let i = 0; i < w.length; i++) {
      const wi = w[i]!;
      if (!Number.isFinite(wi) || wi < 0) {
        throw new Error(`resolve(${tag}): weights[${i}] = ${wi} (must be finite and >= 0)`);
      }
      sum += wi;
    }
    if (sum <= 0) throw new Error(`resolve(${tag}): weights sum to ${sum} (must be positive)`);
    return { kind: "index", weights: w };
  }
  if (opts.arity !== undefined) {
    if (!Number.isInteger(opts.arity) || opts.arity < 1) {
      throw new Error(`resolve(${tag}): arity ${opts.arity} (must be an integer >= 1)`);
    }
    return { kind: "index", weights: new Array<number>(opts.arity).fill(1) };
  }
  if (opts.range !== undefined) {
    const [lo, hi] = opts.range;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) {
      throw new Error(`resolve(${tag}): range [${lo}, ${hi}) (must be finite with lo < hi)`);
    }
    return { kind: "range", lo, hi };
  }
  if (opts.normal !== undefined) return { kind: "normal" };
  return { kind: "u" };
}

// `force` must be a legal value for the draw's kind — an illegal force is a
// bundle bug, not a lever. (A zero-WEIGHT index is legal: that is what
// force means.)
function checkForce(tag: string, parsed: ParsedOpts, force: number): void {
  switch (parsed.kind) {
    case "u":
      if (!(force >= 0 && force < 1)) {
        throw new Error(`resolve(${tag}): force ${force} outside [0, 1)`);
      }
      return;
    case "index":
      if (!Number.isInteger(force) || force < 0 || force >= parsed.weights.length) {
        throw new Error(
          `resolve(${tag}): force ${force} is not an index into ${parsed.weights.length} outcomes`,
        );
      }
      return;
    case "range":
      if (!(force >= parsed.lo && force < parsed.hi)) {
        throw new Error(`resolve(${tag}): force ${force} outside [${parsed.lo}, ${parsed.hi})`);
      }
      return;
    case "normal":
      if (!Number.isFinite(force)) {
        throw new Error(`resolve(${tag}): force ${force} must be finite for a normal draw`);
      }
      return;
  }
}

// Left-to-right cumulative fold. Comparing `u * total < acc` is the exact-
// arithmetic form of `u < cdf[i]` (no division, so integer weights fold with
// zero float error — arity folds land bit-identically on floor(u * n)). A
// zero-weight outcome leaves acc unchanged, so a draw can never select it;
// the fallback (float edge where u * total rounds up to total) is the last
// positive-weight index.
function foldWeights(u: number, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  const scaled = u * total;
  let acc = 0;
  let lastPositive = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    if (w > 0) lastPositive = i;
    acc += w;
    if (w > 0 && scaled < acc) return i;
  }
  return lastPositive;
}

// --- kernel ----------------------------------------------------------------

// Shape one answer from a uniform source. Consumption per kind: plain /
// range / weights / arity — 1 uniform; normal — 2. `force` is applied AFTER
// consuming, so a forced and an unforced run have bit-identical draw
// streams downstream (the counterfactual-twin contract).
function shapeFrom(next: () => number, tag: string, opts?: ResolveOpts): ResolutionRecord {
  const parsed = parseOpts(tag, opts);

  let kind: ResolutionKind;
  let value: number;
  switch (parsed.kind) {
    case "u": {
      kind = "u";
      value = next();
      break;
    }
    case "index": {
      kind = "index";
      value = foldWeights(next(), parsed.weights);
      break;
    }
    case "range": {
      kind = "range";
      value = shapeRange(next(), parsed.lo, parsed.hi);
      break;
    }
    case "normal": {
      kind = "normal";
      const u1 = next();
      const u2 = next();
      value = shapeNormal(u1, u2);
      break;
    }
  }

  const record: ResolutionRecord = { tag, kind, value };
  if (opts?.force !== undefined) {
    checkForce(tag, parsed, opts.force);
    record.value = opts.force;
    record.forced = true;
  }
  if (opts?.note !== undefined) record.note = opts.note;
  return record;
}

// Pure kernel over the threaded RNG. Validates opts, consumes draws from
// `rng` per the consumption table, applies `force` AFTER consuming, returns
// the frozen record + threaded RNG.
export function resolveDraw(
  rng: RNGState,
  tag: string,
  opts?: ResolveOpts,
): { record: ResolutionRecord; rng: RNGState } {
  let cur = rng;
  const next = () => {
    const r = nextUniform(cur);
    cur = r.rng;
    return r.value;
  };
  const record = shapeFrom(next, tag, opts);
  return { record, rng: cur };
}

// --- backings --------------------------------------------------------------

// One-tick live wrapper over the kernel. `resolve` accumulates records
// against an internal cursor; `finish()` returns the threaded RNGState and
// the transcript. Construct one per tick; never reuse across ticks.
export function makeRngResolve(rng: RNGState): {
  resolve: Resolve;
  finish: () => { rng: RNGState; records: ResolutionRecord[] };
} {
  let cur = rng;
  const records: ResolutionRecord[] = [];
  let finished = false;
  const resolve: Resolve = (tag, opts) => {
    if (finished) throw new Error(`resolve(${tag}) after finish() — construct one resolver per tick`);
    const r = resolveDraw(cur, tag, opts);
    cur = r.rng;
    records.push(r.record);
    return r.record.value;
  };
  return {
    resolve,
    finish: () => {
      finished = true;
      return { rng: cur, records };
    },
  };
}

// Replay wrapper: serves recorded answers positionally, verbatim — never
// re-derives. Tag or kind mismatch at the cursor throws (physics drift
// against an old transcript must fail loudly, not silently rewrite the
// past); exhaustion throws; `finish()` with unconsumed records throws.
export function makeRecordResolve(records: ResolutionRecord[]): {
  resolve: Resolve;
  finish: () => void;
} {
  let cursor = 0;
  const resolve: Resolve = (tag, opts) => {
    const parsed = parseOpts(tag, opts);
    const entry = records[cursor];
    if (!entry) {
      throw new Error(`record replay exhausted: resolve(${tag}) at position ${cursor}, transcript has ${records.length}`);
    }
    if (entry.tag !== tag) {
      throw new Error(`record replay drift at position ${cursor}: transcript has tag ${entry.tag}, bundle resolved ${tag}`);
    }
    if (entry.kind !== parsed.kind) {
      throw new Error(`record replay drift at position ${cursor} (${tag}): transcript kind ${entry.kind}, bundle resolved ${parsed.kind}`);
    }
    cursor++;
    return entry.value;
  };
  return {
    resolve,
    finish: () => {
      if (cursor !== records.length) {
        throw new Error(
          `record replay finished with ${records.length - cursor} unconsumed records (next: ${records[cursor]!.tag})`,
        );
      }
    },
  };
}

// Verify wrapper: re-derives from `rng` via the kernel AND compares each
// answer (tag, kind, value, forced) against the transcript; any mismatch
// throws with tag + position context. Drift detector for CI.
export function makeVerifyResolve(
  rng: RNGState,
  records: ResolutionRecord[],
): {
  resolve: Resolve;
  finish: () => { rng: RNGState };
} {
  let cur = rng;
  let cursor = 0;
  const resolve: Resolve = (tag, opts) => {
    const entry = records[cursor];
    if (!entry) {
      throw new Error(`verify exhausted: resolve(${tag}) at position ${cursor}, transcript has ${records.length}`);
    }
    const r = resolveDraw(cur, tag, opts);
    cur = r.rng;
    const derived = r.record;
    if (
      entry.tag !== derived.tag ||
      entry.kind !== derived.kind ||
      !Object.is(entry.value, derived.value) ||
      (entry.forced === true) !== (derived.forced === true)
    ) {
      throw new Error(
        `verify drift at position ${cursor}: transcript {tag: ${entry.tag}, kind: ${entry.kind}, value: ${entry.value}${entry.forced ? ", forced" : ""}} vs re-derived {tag: ${derived.tag}, kind: ${derived.kind}, value: ${derived.value}${derived.forced ? ", forced" : ""}}`,
      );
    }
    cursor++;
    return derived.value;
  };
  return {
    resolve,
    finish: () => {
      if (cursor !== records.length) {
        throw new Error(`verify finished with ${records.length - cursor} unconsumed records (next: ${records[cursor]!.tag})`);
      }
      return { rng: cur };
    },
  };
}

// Entropy wrapper: kernel shaping over an injected uniform source instead
// of mulberry32. `finish()` returns the transcript — under this backing the
// transcript is the ONLY record of the past.
export function makeEntropyResolve(draw: () => number): {
  resolve: Resolve;
  finish: () => { records: ResolutionRecord[] };
} {
  const records: ResolutionRecord[] = [];
  let finished = false;
  const next = () => {
    const u = draw();
    if (typeof u !== "number" || !(u >= 0 && u < 1)) {
      throw new Error(`entropy draw() returned ${u}, outside [0, 1)`);
    }
    return u;
  };
  const resolve: Resolve = (tag, opts) => {
    if (finished) throw new Error(`resolve(${tag}) after finish() — construct one resolver per tick`);
    const record = shapeFrom(next, tag, opts);
    records.push(record);
    return record.value;
  };
  return {
    resolve,
    finish: () => {
      finished = true;
      return { records };
    },
  };
}

// --- tag discipline --------------------------------------------------------

const TAG_SEPARATOR = ":";

function checkTagPart(part: string): void {
  if (part.length === 0) throw new Error("tag part must be non-empty");
  if (part.includes(TAG_SEPARATOR)) {
    throw new Error(`tag part ${JSON.stringify(part)} contains reserved separator "${TAG_SEPARATOR}"`);
  }
}

// `makeTag('tron')('ai-turn', 3)` → 'tron:ai-turn:3'. ':' is the reserved
// separator; empty parts and parts containing ':' throw.
export function makeTag(domain: string): (...parts: (string | number)[]) => string {
  checkTagPart(domain);
  return (...parts) => {
    let tag = domain;
    for (const p of parts) {
      const s = String(p);
      checkTagPart(s);
      tag += TAG_SEPARATOR + s;
    }
    return tag;
  };
}

// parseTag(makeTag(d)(...ps)) round-trips to [d, ...ps.map(String)].
export function parseTag(tag: string): string[] {
  const parts = tag.split(TAG_SEPARATOR);
  for (const p of parts) checkTagPart(p);
  return parts;
}
