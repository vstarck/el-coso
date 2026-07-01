// Julia substrate config.

export type FractalMode = "julia" | "mandelbrot";

// The path c traces through the complex plane:
//   c(phase) = center + radius · (cos phase, sin phase)
// `speed` = radians advanced per tick. speed 0 ⇒ c is parked (a still set);
// radius 0 ⇒ c sits exactly at `center` (park at an arbitrary point).
export type Orbit = {
  center_re: number;
  center_im: number;
  radius: number;
  speed: number;
};

export type JuliaConfig = {
  id: string;
  // Default render mode. The lens seeds its live mode from this — Julia and
  // Mandelbrot are two views of the same z → z² + c family (which variable the
  // pixel drives), so the lens may flip it at runtime.
  mode: FractalMode;
  orbit: Orbit;
  // Internal escape-time buffer side (the short edge), in px. The lens scales
  // it to fill the viewport — the perf lever: bigger = crisper + costlier.
  res: number;
};

// c at a given orbit phase. Pure — shared by init + tick.
export function cAtPhase(orbit: Orbit, phase: number): { re: number; im: number } {
  return {
    re: orbit.center_re + orbit.radius * Math.cos(phase),
    im: orbit.center_im + orbit.radius * Math.sin(phase),
  };
}
