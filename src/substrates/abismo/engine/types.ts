// abismo substrate state — the whole "world" is one coordinate: `depth`, the
// log10 of the zoom into the fixed center. Because depth is a COORDINATE (not a
// process), the dive is exactly reversible — scrolling up recomputes shallower
// frames bit-identically, no history buffer needed. Tiny state ⇒ trivial
// keyframes + exact replay. The fractal itself is computed by the lens.
export type SubstrateState = {
  depth: number; // log10(zoom) into the center; 0 = fully zoomed out
  tick: number;
};

// Per-tick injected input — the entire action surface (Q4). `scrollDelta` is the
// signed change in depth this tick (down/forward = +, up/back = −). The lens
// feeds it from wheel/scroll input, or from the auto-dive when idle; either way
// it enters the RECORDED input stream, so replay is exact (cf. nm5's turnDelta).
export type AbismoInputs = {
  scrollDelta: number;
};
