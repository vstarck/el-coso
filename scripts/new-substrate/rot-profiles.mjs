/* The answer-sets the rot-test generates. Four profiles chosen as a
 * covering array — between them they exercise every option of every
 * question at least once, so a template that stops compiling for any answer
 * fails the rot guard. */

export const ROT_PROFILES = {
  "rot-p1": { render: "canvas2d", viewport: "full-bleed", storage: "channels", agency: "none", pace: "autonomous", commit: "per-tick" },
  "rot-p2": { render: "ascii", viewport: "flat", storage: "plain", agency: "held", pace: "event-driven", commit: "per-event" },
  "rot-p3": { render: "dom", viewport: "bounded", storage: "channels", agency: "discrete", pace: "render-only", commit: "per-input" },
  "rot-p4": { render: "webgl", viewport: "safe-area", storage: "plain", agency: "stamp", pace: "autonomous", commit: "per-tick" },
};
