/* Spec §14 — tickToX / laneY geometry helpers. Lane count is dynamic
   (driven by the number of branches in the live history) and no longer a
   compile-time constant — pass it through to totalHeightFor. */

export const LANE_HEIGHT = 30;
export const TICK_AXIS_HEIGHT = 30;
export const TOP_PAD = 12;
export const BOTTOM_PAD = 10;
export const LABEL_GUTTER = 132;
export const RIGHT_PAD = 56;
export const NODE_R = 4;
export const NODE_R_ACTIVE = 5;
export const NODE_R_HEAD = 6.5;

// Minimum on-screen distance between two adjacent ticks (in CSS px). The
// timeline viewport's tick span is capped so consecutive commits never get
// closer than this — early-game commits breathe, and the floor stays
// constant as the head advances until the head simply outpaces it.
// Tweak this number to make commits sit closer / farther apart.
export const MIN_TICK_PX = 20;

// Per-branch baseline line. Drawn from fork_tick → head_tick on each
// branch's lane, behind the commit nodes. Tweak the opacities to dial how
// loud the branch backbones read; set to 0 to hide them entirely.
export const BRANCH_LINE_OPACITY_ACTIVE = 0.55;
export const BRANCH_LINE_OPACITY_ALIVE = 0.35;
export const BRANCH_LINE_OPACITY_ABANDONED = 0.18;
// Bezier connector from a branch's parent commit to its fork point. Same
// opacity scale as the baselines.
export const BRANCH_CURVE_OPACITY = 0.5;
// Fork-point inherited glyph — the parent's commit glyph echoed on the
// new branch's lane at fork_tick, telling the eye "this branch was born
// from that move."
export const FORK_GLYPH_OPACITY = 0.35;
// Empty columns reserved to the right of the live head so the HEAD pin
// never kisses the right edge of the timeline.
export const HEAD_BUFFER_COLUMNS = 2;

// The timeline x-axis is *commit-indexed*, not tick-indexed: each
// commit-bearing tick occupies one column at MIN_TICK_PX, and ticks
// between commits interpolate linearly. Result: empty stretches of time
// (e.g. Conway's 99 ticks between periodic commits) collapse to nothing.
// `columnTicks` is the sorted unique list of commit ticks, supplied by
// the caller (see `historyView` for the construction).

export function tickToColumn(tick: number, columnTicks: number[]): number {
  if (columnTicks.length === 0) return tick;
  // Single-commit case: with no second point we have no scale, so any
  // tick past the only commit pins to column ±1 — the playhead waits
  // one column-width away instead of racing off to `tick` columns
  // before the next commit lands and snaps it back.
  if (columnTicks.length === 1) return Math.sign(tick - columnTicks[0]!);
  const last = columnTicks.length - 1;
  const step = (columnTicks[last]! - columnTicks[0]!) / last || 1;
  if (tick <= columnTicks[0]!) return (tick - columnTicks[0]!) / step;
  if (tick >= columnTicks[last]!) {
    return last + (tick - columnTicks[last]!) / step;
  }
  // Binary search adjacent columns.
  let lo = 0;
  let hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (columnTicks[mid]! <= tick) lo = mid;
    else hi = mid;
  }
  const t_lo = columnTicks[lo]!;
  const t_hi = columnTicks[hi]!;
  if (t_lo === t_hi) return lo;
  return lo + (tick - t_lo) / (t_hi - t_lo);
}

export function columnToTick(column: number, columnTicks: number[]): number {
  if (columnTicks.length === 0) return Math.round(column);
  if (columnTicks.length === 1) {
    return Math.round(columnTicks[0]! + column);
  }
  const last = columnTicks.length - 1;
  const step = (columnTicks[last]! - columnTicks[0]!) / last || 1;
  if (column <= 0) {
    return Math.round(columnTicks[0]! + column * step);
  }
  if (column >= last) {
    return Math.round(columnTicks[last]! + (column - last) * step);
  }
  const lo = Math.floor(column);
  const hi = lo + 1;
  const frac = column - lo;
  return Math.round(columnTicks[lo]! + frac * (columnTicks[hi]! - columnTicks[lo]!));
}

// Number of columns that fit in the timeline viewport at MIN_TICK_PX
// spacing. Past this, panning is required to see more history.
export function visibleColumnSpan(width: number): number {
  const usable = Math.max(0, width - LABEL_GUTTER - RIGHT_PAD);
  return Math.max(1, Math.floor(usable / MIN_TICK_PX));
}

// Effective viewport column range — windowed. Left edge sits at
// `panColumn`, right edge at `panColumn + visibleColumnSpan(width)`.
export function computeColumnRange(
  width: number,
  panColumn: number,
): [number, number] {
  const span = visibleColumnSpan(width);
  return [panColumn, panColumn + span];
}

// The pan offset that keeps the live head sitting near the right edge
// with HEAD_BUFFER_COLUMNS of slack. Used in auto-follow mode.
export function followHeadPanColumn(
  width: number,
  maxHeadColumn: number,
  playheadColumn: number,
): number {
  const span = visibleColumnSpan(width);
  const naturalMax =
    Math.max(maxHeadColumn, playheadColumn) + HEAD_BUFFER_COLUMNS;
  return Math.max(0, naturalMax - span);
}

export function totalHeightFor(lanesCount: number): number {
  return TOP_PAD + TICK_AXIS_HEIGHT + lanesCount * LANE_HEIGHT + BOTTOM_PAD;
}

export const laneY = (laneIdx: number) =>
  TOP_PAD + TICK_AXIS_HEIGHT + LANE_HEIGHT / 2 + laneIdx * LANE_HEIGHT;

export function makeColumnToX(width: number, columnRange: [number, number]) {
  const [c0, c1] = columnRange;
  const usable = width - LABEL_GUTTER - RIGHT_PAD;
  const span = c1 - c0;
  if (span <= 0) return (_c: number) => LABEL_GUTTER;
  return (c: number) => LABEL_GUTTER + ((c - c0) / span) * usable;
}

export function makeXToColumn(width: number, columnRange: [number, number]) {
  const [c0, c1] = columnRange;
  const usable = width - LABEL_GUTTER - RIGHT_PAD;
  const span = c1 - c0;
  if (span <= 0) return (_x: number) => c0;
  return (x: number) => {
    const ratio = Math.max(0, Math.min(1, (x - LABEL_GUTTER) / usable));
    return c0 + ratio * span;
  };
}
