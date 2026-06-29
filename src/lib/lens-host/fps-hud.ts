/* makeFpsHud — a tiny built-in FPS overlay for export embeds. Drop `?fps` on
 * any exported embed URL (or set `globalThis.__COSO_FPS__`) and the four-up
 * FpsStats paints in the corner, so you can measure an embed's performance in
 * place on a real page. DOM-only (no React, no store) and gated off by default,
 * mirroring the `?profile` frame-profiler gate — production embeds never paint
 * it unless asked. The app chrome shows the same numbers in its toolbar, so it
 * doesn't use this.
 */

import type { FpsStats } from "./fps-stats";

export type FpsHud = {
  report: (stats: FpsStats) => void;
  destroy: () => void;
};

export function makeFpsHud(parent: HTMLElement): FpsHud {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "absolute",
    top: "6px",
    right: "6px",
    zIndex: "2147483647",
    font: "11px/1.45 ui-monospace, Menlo, Consolas, monospace",
    color: "#9effa0",
    background: "rgba(0,0,0,0.6)",
    padding: "4px 7px",
    borderRadius: "5px",
    whiteSpace: "pre",
    pointerEvents: "none",
    letterSpacing: "0.02em",
  } as Partial<CSSStyleDeclaration>);

  // The overlay is absolutely positioned — make the parent a positioning
  // context if it isn't one, and restore on destroy.
  const wasStatic =
    typeof getComputedStyle === "function" &&
    getComputedStyle(parent).position === "static";
  if (wasStatic) parent.style.position = "relative";
  parent.appendChild(el);

  const r = (n: number): string => String(Math.round(n)).padStart(3, " ");

  return {
    report: (s) => {
      el.textContent =
        `fps ${r(s.instant)}\n` +
        `avg ${r(s.averageTotal)}\n` +
        `10s ${r(s.average10s)}\n` +
        `min ${r(s.min10s)}`;
    },
    destroy: () => {
      if (el.parentNode === parent) parent.removeChild(el);
      if (wasStatic) parent.style.position = "";
    },
  };
}

/** Is the embed FPS HUD requested? `?fps` in the URL, or `__COSO_FPS__` truthy.
 *  SSR/headless-safe (no `location`/`globalThis` ⇒ off). */
export function fpsHudEnabledFromEnv(): boolean {
  const g = (globalThis as { __COSO_FPS__?: unknown }).__COSO_FPS__;
  if (g !== undefined && g !== false) return true;
  if (typeof location !== "undefined" && typeof location.search === "string") {
    return new URLSearchParams(location.search).has("fps");
  }
  return false;
}
