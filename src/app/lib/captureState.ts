/* Capture the substrate's raw State as JSON — the "state→view" dump.
 *
 * Lens-independent on purpose: this is the substrate's current State at the
 * playhead (`history.substrate.read`), the exact data every lens renders
 * from. There is no lens hook and no `snapshot()` round-trip — the chrome
 * already holds the State, so the same button works for every substrate and
 * quietly demonstrates the thesis: the view is a pure function of this.
 *
 * Typed-array channels (the SoA occupancy / field buffers) serialize as plain
 * number arrays so the JSON reads cleanly; everything else passes through.
 */

function stateReplacer(_key: string, value: unknown): unknown {
  // Any TypedArray view (Uint8 / Float32 / Int32 / …) → plain number array.
  // DataView is excluded (not iterable) — same rule as history.ts's
  // `isTypedArray`. Behavior-based, not an `instanceof` enumeration, so a new
  // channel type doesn't silently fall through (see polymorphic-helpers).
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  return value;
}

/** Pretty-print the substrate State as JSON, with channels flattened to
 *  plain arrays. */
export function stateToJson(state: unknown): string {
  return JSON.stringify(state, stateReplacer, 2);
}

function downloadJson(json: string, tick: number): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `state-tick-${String(tick).padStart(6, "0")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy the State JSON to the clipboard (the writing-ergonomic path — paste
 *  straight into a doc). Falls back to a `.json` download when the clipboard
 *  API is unavailable (non-secure context) or denied. Returns which path ran
 *  so the caller can show the right confirmation. */
export async function captureState(
  state: { tick: number },
  // accepts any State shape; `tick` is read for the download filename
): Promise<"copied" | "downloaded"> {
  const json = stateToJson(state);
  try {
    await navigator.clipboard.writeText(json);
    return "copied";
  } catch {
    downloadJson(json, state.tick);
    return "downloaded";
  }
}
