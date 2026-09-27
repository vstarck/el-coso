// The config tape (spec/31). Pure functions over a config's plain-data shape — the same dispatch as `cloneField` in
// history.ts (typed array / array / plain object / scalar), so anything a keyframe can hold, the tape can hold.
//
// Three rules carry the design, and each has a row in tests/history-config-tape.test.ts:
//  · A tape snapshot is IMMUTABLE. `tapeShare` reuses unchanged subtrees of the previous snapshot by reference, so an
//    edit costs its changed path — a slider drag records one snapshot per tick, and a 476 KB config cloned whole per
//    tick would be ~28 MB/s.
//  · `tapeRestore` writes INTO the live config and never stores a tape object in it. Lenses capture
//    `const config = history.config` at mount (~35 of them) and six engines key caches on it, so its identity must
//    survive; and a later in-place write must not reach the tape.
//  · A pending edit is a PATCH (the edited paths), never a snapshot: applied at the head, a snapshot taken at an
//    earlier tick would also revert every key edited in between.
//  · Nothing here runs per tick. Edits arrive through `historyEditConfig` and move the tape along their path only
//    (`tapeSetPath`, O(depth)); the whole-config walk (`tapeShare`) runs at a root snapshot, and in the opt-in guard.
//    S235: a per-tick diff measured 16 ms on rele and 28 ms on tilin, per tick.

type Obj = Record<string, unknown>;
type Typed = ArrayBufferView & ArrayLike<number> & { set(src: ArrayLike<number>): void };

const isTyped = (v: unknown): v is Typed => ArrayBuffer.isView(v) && !(v instanceof DataView);
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v) && !isTyped(v);
const copyTyped = (v: Typed): Typed => new (v.constructor as new (src: Typed) => Typed)(v);

function typedEqual(a: Typed, b: Typed): boolean {
  if (a.constructor !== b.constructor || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function cloneDeep(v: unknown): unknown {
  if (isTyped(v)) return copyTyped(v);
  if (Array.isArray(v)) return v.map(cloneDeep);
  if (isObj(v)) { const o: Obj = {}; for (const k of Object.keys(v)) o[k] = cloneDeep(v[k]); return o; }
  return v;
}

/** `prev` itself when `live` equals it; otherwise a new snapshot sharing every unchanged subtree of `prev`.
 *  `prev === undefined` gives a full deep snapshot. Scalars compare with Object.is (−0 ≠ 0, NaN = NaN). */
export function tapeShare(live: unknown, prev: unknown): unknown {
  if (isTyped(live)) return isTyped(prev) && typedEqual(live, prev) ? prev : copyTyped(live);
  if (Array.isArray(live)) {
    const p = Array.isArray(prev) ? prev : null;
    let same = p !== null && p.length === live.length;
    const out = live.map((x, i) => {
      const s = tapeShare(x, p?.[i]);
      if (!Object.is(s, p?.[i])) same = false; // Object.is: a NaN leaf returns itself, and NaN !== NaN
      return s;
    });
    return same ? prev : out;
  }
  if (isObj(live)) {
    const p = isObj(prev) ? prev : null;
    const keys = Object.keys(live);
    let same = p !== null && Object.keys(p).length === keys.length;
    const out: Obj = {};
    for (const k of keys) {
      const had = p !== null && Object.prototype.hasOwnProperty.call(p, k);
      const s = tapeShare(live[k], had ? p![k] : undefined);
      if (!had || !Object.is(s, p![k])) same = false;
      out[k] = s;
    }
    return same ? prev : out;
  }
  return Object.is(live, prev) ? prev : live;
}

/** write `snap` INTO `live` in place: keys overwritten, absent keys deleted, typed arrays `.set()` (or replaced by a
 *  copy on a subtype / length mismatch), same-shaped arrays and objects recursed into. Never aliases `snap`.
 *  `prev`, when given, is a snapshot `live` is known to EQUAL (the tape, or the staged snapshot): every subtree `snap`
 *  shares with it by reference is already right in `live` and is skipped, so a restore costs the paths edited between
 *  the two snapshots, and nothing across a stretch with no edit. (S235: a whole-config walk measured 16 ms on rele.) */
export function tapeRestore(live: unknown, snap: unknown, prev?: unknown): void {
  if (prev !== undefined && Object.is(snap, prev)) return;
  const p = prev !== undefined && prev !== null && typeof prev === "object" ? (prev as Obj) : undefined;
  const same = (k: string | number): boolean => p !== undefined && Object.prototype.hasOwnProperty.call(p, k) && Object.is((snap as Obj)[k as string], p[k as string]);
  if (Array.isArray(live) && Array.isArray(snap)) {
    live.length = snap.length;
    for (let i = 0; i < snap.length; i++) if (!same(i)) live[i] = restoreSlot(live[i], snap[i], p?.[i]);
    return;
  }
  if (isObj(live) && isObj(snap)) {
    for (const k of Object.keys(p ?? live)) if (!Object.prototype.hasOwnProperty.call(snap, k)) delete live[k];
    for (const k of Object.keys(snap)) if (!same(k)) live[k] = restoreSlot(live[k], snap[k], p?.[k]);
    return;
  }
  throw new Error(`config tape: cannot restore a ${describe(snap)} into a ${describe(live)} in place`);
}

/** the value a slot holding `cur` should hold after restoring `want`: `cur` itself, rewritten in place, when shapes match */
function restoreSlot(cur: unknown, want: unknown, prev?: unknown): unknown {
  if (isTyped(want)) {
    if (isTyped(cur) && cur.constructor === want.constructor && cur.length === want.length) { cur.set(want); return cur; }
    return copyTyped(want);
  }
  if ((Array.isArray(want) && Array.isArray(cur)) || (isObj(want) && isObj(cur))) { tapeRestore(cur, want, prev); return cur; }
  return cloneDeep(want);
}

const describe = (v: unknown): string => (isTyped(v) ? "typed array" : Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** a new snapshot equal to `snap` with `path` set to `value` (`undefined` deletes an object key), copy-on-write along
 *  the path only: every subtree off the path is shared with `snap`, and `snap` is not written. O(depth). */
export function tapeSetPath(snap: unknown, path: readonly (string | number)[], value: unknown): unknown {
  if (path.length === 0) return cloneDeep(value);
  const [k, ...rest] = path as [string | number, ...(string | number)[]];
  if (isTyped(snap)) {
    if (rest.length > 0 || value === undefined || typeof value !== "number") throw new Error(`config tape: typed array element ${String(k)} takes a number`);
    const copy = copyTyped(snap);
    (copy as unknown as number[])[k as number] = value;
    return copy;
  }
  if (Array.isArray(snap)) {
    if (value === undefined && rest.length === 0) throw new Error(`config tape: cannot delete array element ${String(k)}`);
    const copy = snap.slice();
    copy[k as number] = rest.length === 0 ? cloneDeep(value) : tapeSetPath(snap[k as number], rest, value);
    return copy;
  }
  if (isObj(snap)) {
    const copy: Obj = { ...snap };
    if (rest.length === 0) { if (value === undefined) delete copy[k as string]; else copy[k as string] = cloneDeep(value); }
    else copy[k as string] = tapeSetPath(snap[k as string], rest, value);
    return copy;
  }
  throw new Error(`config tape: path crosses a ${describe(snap)} at "${String(k)}"`);
}

// ---------------------------------------------------------------- patches (pending edits)
export type TapeOp = { path: (string | number)[]; value: unknown } | { path: (string | number)[]; delete: true };
export type TapePatch = TapeOp[];

/** the leaves where `live` differs from `base`, as set / delete operations (values cloned) */
export function tapeDiff(live: unknown, base: unknown, at: (string | number)[] = [], out: TapePatch = []): TapePatch {
  if (Array.isArray(live) && Array.isArray(base) && live.length === base.length) {
    for (let i = 0; i < live.length; i++) tapeDiff(live[i], base[i], [...at, i], out);
    return out;
  }
  if (isObj(live) && isObj(base)) {
    for (const k of Object.keys(base)) if (!Object.prototype.hasOwnProperty.call(live, k)) out.push({ path: [...at, k], delete: true });
    for (const k of Object.keys(live)) {
      if (Object.prototype.hasOwnProperty.call(base, k)) tapeDiff(live[k], base[k], [...at, k], out);
      else out.push({ path: [...at, k], value: cloneDeep(live[k]) });
    }
    return out;
  }
  if (!Object.is(tapeShare(live, base), base)) out.push({ path: at, value: cloneDeep(live) });
  return out;
}

/** apply a patch INTO `live` in place, in order (later operations win) */
export function tapeApply(live: unknown, patch: TapePatch): void {
  for (const op of patch) {
    if (op.path.length === 0) {
      if ("delete" in op) throw new Error("config tape: a patch cannot delete the config itself");
      tapeRestore(live, op.value);
      continue;
    }
    let o = live as Obj;
    for (const k of op.path.slice(0, -1)) {
      const next = o[k as string];
      if (next === null || typeof next !== "object") throw new Error(`config tape: patch path ${op.path.join(".")} crosses a ${describe(next)} at "${String(k)}"`);
      o = next as Obj;
    }
    const leaf = op.path[op.path.length - 1]! as string;
    if ("delete" in op) delete o[leaf];
    else o[leaf] = restoreSlot(o[leaf], op.value);
  }
}
