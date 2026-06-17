/* Key-controls — maintain live held-key state and expose a single
 * `current()` query the lens samples once per tick. The kit the Agency
 * design question (Q4) reaches for when `Inputs` is a *continuous / held*
 * heading or vector (drive, steer) rather than a one-shot discrete event.
 *
 * Contrast with a hand-rolled keydown handler, which is
 * *event-driven* (one keydown = one historyTick). This kit is for the
 * other shape: an autonomous substrate whose rAF-driven tick reads the
 * *currently held* control each step. The lens hands `current()` to
 * `historyTick` every tick, so a real-time substrate records exactly one
 * input per tick and replays bit-exact.
 *
 * Semantics: **latest-press-wins, falling back to any earlier key still
 * down.** Hold Right and the value is `right`; press Up while Right is
 * still held and it becomes `up`; release Up and it falls back to `right`
 * (still held). This is the classic held-direction feel for snake / tron
 * / twin-stick steering. When nothing mapped is held, `current()` returns
 * the configured `neutral` value.
 *
 * The kit owns keydown / keyup / blur-clear / preventDefault (so arrow
 * keys don't scroll the page). The lens owns the keymap and reads the
 * snapshot — it never touches the DOM event surface. */

export type KeyControlsOpts<V> = {
  /** Map from `KeyboardEvent.key` to the value that key holds while down.
   *  e.g. `{ ArrowUp: "up", w: "up", ArrowLeft: "left", … }`. Unmapped
   *  keys are ignored (no preventDefault, no state change). */
  keymap: Record<string, V>;
  /** Value `current()` returns when no mapped key is held. */
  neutral: V;
  /** Element / window to bind keydown+keyup on. Default `window`.
   *  Blur-clear is always bound on `window` (covers alt-tab). */
  target?: Window | HTMLElement;
  /** Opt-in tap buffer. When set, every keydown is also pushed to a small
   *  FIFO so taps that land *between* sampling ticks aren't lost — the
   *  fix for grid-mover steering, where two quick presses in one tick
   *  window would otherwise collapse to the latest. `next()` drains the
   *  FIFO one entry per call (oldest-first), falling back to the held
   *  value when empty. Buffered entries older than `bufferMs` are dropped
   *  so a stale, never-consumed press can't fire later, and the queue is
   *  length-capped so frantic mashing can't enqueue a long macro. */
  bufferMs?: number;
};

export type KeyControlsHandle<V> = {
  /** Value of the most-recently-pressed still-held mapped key, or
   *  `neutral` if none is held. Safe to call every tick. */
  current: () => V;
  /** FIFO-drain the next buffered keydown (oldest still within `bufferMs`),
   *  or `current()` if the buffer is empty. Call once per tick when
   *  sampling. No-op equivalent to `current()` unless `bufferMs` is set. */
  next: () => V;
  /** Forget all held keys and any buffered taps. Wired automatically on
   *  window blur; exposed for lenses that drop input on pause / suspend. */
  clear: () => void;
  /** Remove every listener. */
  detach: () => void;
};

export function attachKeyControls<V>(
  opts: KeyControlsOpts<V>,
): KeyControlsHandle<V> {
  const { keymap, neutral } = opts;
  const target = opts.target ?? window;
  const buffer_ms = opts.bufferMs ?? 0;
  const BUFFER_CAP = 3; // frantic mashing can't queue a longer macro

  // Press-order stack of mapped keys currently down. The top is the
  // active control; popping a released key falls back to the one beneath.
  const held: string[] = [];
  // Opt-in tap FIFO: timestamped keydown values, drained one per tick.
  const buffer: { value: V; t: number }[] = [];

  function current(): V {
    const top = held[held.length - 1];
    return top === undefined ? neutral : keymap[top]!;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!(e.key in keymap)) return;
    e.preventDefault();
    // keydown auto-repeats while a key is held; only record the first.
    if (held.includes(e.key)) return;
    held.push(e.key);
    if (buffer_ms > 0) {
      buffer.push({ value: keymap[e.key]!, t: now() });
      if (buffer.length > BUFFER_CAP) buffer.shift();
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (!(e.key in keymap)) return;
    const i = held.indexOf(e.key);
    if (i !== -1) held.splice(i, 1);
  }
  function clear(): void {
    held.length = 0;
    buffer.length = 0;
  }

  function next(): V {
    if (buffer_ms <= 0) return current();
    // Drop stale, never-consumed presses from the front, then take the
    // oldest fresh one. Empty ⇒ fall back to the held value.
    const cutoff = now() - buffer_ms;
    while (buffer.length > 0 && buffer[0]!.t < cutoff) buffer.shift();
    const head = buffer.shift();
    return head === undefined ? current() : head.value;
  }

  target.addEventListener("keydown", onKeyDown as EventListener);
  target.addEventListener("keyup", onKeyUp as EventListener);
  window.addEventListener("blur", clear);

  return {
    current,
    next,
    clear,
    detach: () => {
      target.removeEventListener("keydown", onKeyDown as EventListener);
      target.removeEventListener("keyup", onKeyUp as EventListener);
      window.removeEventListener("blur", clear);
    },
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
