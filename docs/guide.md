# el coso — a guide

A short tour of how the engine is put together and how to build on it. The
[README](../README.md) has the one-paragraph pitch; this fills in the core
loop, the invariants that make time travel free, what a lens is, and the two
commands you'll actually run — `new-substrate` and `export`.

---

## The core loop

Everything rests on one shape. A world — a **substrate** — is a piece of
state plus one pure step:

```
(state, inputs, rng) → (state, rng)
```

A substrate ships as a three-function **bundle**:

```ts
type SubstrateBundle<State, Config, Inputs> = {
  alloc:     (config: Config) => { read: State; write: State };
  initState: (state: State, config: Config) => void;
  tick:      (read, write, config, rng, inputs) => rng;
};
```

- **`alloc`** allocates the world's state twice — a *read* buffer (the
  current frame) and a *write* buffer (the next one).
- **`initState`** seeds the opening position from the config.
- **`tick`** is the step. It reads `read`, writes the next frame into
  `write`, and returns the next RNG. The engine then swaps the buffers, so
  last tick's `write` becomes this tick's `read`.

`config` is the world's fixed parameters (board size, rules, the puzzle);
it never changes within a run. `inputs` is whatever the player did this
tick — a steering direction, a placed edit, or nothing at all for a world
that runs itself. `rng` is a small seeded value threaded *through* the
step: the tick takes one and returns the next, so randomness is replayable
rather than ambient.

The engine itself is tiny — it allocates, ticks, and swaps. It has **no
clock**. Nothing inside it decides when a tick happens; that is the lens's
job (see below), which is why one world can be turn-based through one view
and real-time through another.

---

## Principles and invariants

Two principles run underneath everything:

- **No magic.** Every behavior is explicit in the data. A tick may read
  only its `state`, `inputs`, `config`, and `rng`. There is no hidden
  coupling and no engine surprise — what a world does is fully visible in
  what it is.
- **The world doesn't help.** The engine never hints, validates, scores, or
  surfaces structure on your behalf. What you learn about a world, you learn
  by watching it run. Looking is free; knowing costs an experiment.

These hold the engine to a set of hard invariants:

- **The tick is pure.** No `Date.now`, no `Math.random`, no I/O. Time enters
  a world only as ticks; randomness only through the threaded RNG.
- **Determinism.** Same seed + same input log ⇒ the same trajectory, every
  time, on every machine.
- **History is therefore free.** The history layer stores the input log plus
  periodic **keyframes** (state snapshots) and a branch tree. Any past
  moment is reconstructed by restoring the nearest keyframe and replaying
  inputs forward. Keyframes are a *pure cache*: making them denser or
  sparser changes replay cost, never the result — keyframing every tick is
  identical to keyframing none.
- **Double buffering.** The tick never mutates its `read` buffer; it only
  fills `write`. This is what lets the engine hand the same `read` state to
  a lens for rendering while the next tick is computed.
- **One owner per fact.** State that changes per entity lives in the world's
  state; fixed parameters live in `config`. Views never write to either —
  they ask, they don't reach in.

Branching and truncation ride the same determinism: rewinding to a past
tick and playing different inputs forks a new branch; truncating a branch
**cascades** (descendants forked past the cut go with it).

---

## Lenses

A **lens** is a view of a world *and* the way you act on it. One world can
have several. A lens owns three things:

- **A forward render.** `renderFrom(state)` draws a given state. It is pure:
  it does not advance time or touch history, and it runs once per frame.
- **The cadence.** A lens that drives a real-time world supplies a `tick`
  and a speed; a turn-based lens omits `tick` and steps only on input. Same
  substrate, different felt time — the choice lives here, not in the engine.
- **Input translation.** The lens turns pointer/keyboard gestures into the
  world's `inputs` shape.

### Render targets

A lens declares what it draws onto:

| `target_kind` | Surface |
|---|---|
| `canvas2d` | a 2D canvas — the default for fields and boards |
| `webgl`    | a GL context — for large fields drawn per-pixel on the GPU |
| `dom`      | plain DOM — e.g. a state read out as live JSON in a terminal |
| `ascii`    | a styled character grid, materialized to `<pre>` or canvas |

No lens is "the truth": a coarse lens is a *different* lens with deliberate,
predictable detail loss, not a degraded fine one. Picking the lens in which
a world becomes legible is part of using the engine.

### Composition and HUD

A lens can be a **composite**: it declares `layers` — child lenses mounted
as a tree over a base. Only the **root** drives the substrate (owns the
`tick`) and answers the chrome's questions; children render on top. This is
how an in-canvas HUD works — a heads-up overlay is just a child layer over
the world view.

The chrome also reads a flat HUD from any lens: `hudMetrics()` returns
label/value pairs (tick, score, fuel, …) shown in the inspector, and
`commitGlyph(payload)` returns one symbol per commit for the timeline tree —
the lens's vocabulary, rendered by the chrome.

The shipped substrates under [`src/substrates/`](../src/substrates/) are the
working references: `conway` is the smallest (zero input, one canvas lens);
`tts` is a `dom` lens that renders the state as live JSON; `blockoide`
composes a deck of layers into one view.

---

## Scaffold a new substrate

```bash
npm run new-substrate
```

The wizard asks **six design questions** — what the world renders onto, how
the viewport relates to it, how state is stored, how the player acts, how
fast it ticks, and what a commit captures — and from your answers scaffolds
a complete `src/substrates/<name>/` package: the engine bundle, a lens, a
puzzle, and a `DESIGN.md` recording the answers. The package is a no-op but
**green and registered** the moment it's generated — the substrate picker
discovers it automatically, with no registry to edit. You then fill in the
verbs (the physics, the render, the puzzles).

The executable reference is [`src/substrates/example/`](../src/substrates/example/),
where every kit import is tagged with the question it answers.

Non-interactive:

```bash
npm run new-substrate -- <name> --from answers.json
```

---

## Export an embed

```bash
npm run export -- <substrate-id>
```

This bundles a substrate into a **self-contained, React-free single file** —
`dist-embed/<id>/<id>.html` (plus a reusable `<id>-embed.js`) — that mounts the
world with no chrome and no framework, suitable for dropping into any page.

The whole run is setupable from the command line:

```bash
npm run export -- tts \
  --puzzle=classic --lens=tts-json --seed=7 --speed=2x \
  --set theme=boomer-blue
```

| Flag | Sets |
|---|---|
| `--puzzle=<id>` | which puzzle to load |
| `--lens=<id>`   | which lens to mount |
| `--seed=<n>`    | the RNG seed |
| `--speed=<id>`  | a speed preset |
| `--set k=v`     | any lens or config tunable (repeatable) |
| `--no-autoplay` | mount paused instead of self-running |
| `--loop`        | restart at the end of the run (substrates that honour it) |
| `--touch-action=<v>` | touch policy: `none` (full capture) / `pan-y` (let vertical scroll through) |
| `--title=<text>` | the page `<title>` |
| `--precomputed=<file>` | bake a JSON blob as the default `config.precomputed` |
| `--js-only`     | emit only the `.js` bundle, skip the standalone `.html` |

Every run also (re)builds two substrate-agnostic files at the `dist-embed/`
root: `embed.html` (the SDK guest runtime) and `sdk.js` (the host bundle,
below). `--skip-guest` skips them; `--skip-typecheck` skips the `tsc` gate.

Export works for any substrate — lenses reach their host through the injected
`host` handle rather than the app store (the "ask, don't reach in" discipline,
now repo-wide and scaffolded by the wizard), so the bundle carries no React or
store. `conway` and `tts` come out at a few kilobytes.

## Drive many embeds — the SDK

A self-contained `<id>.html` is enough to drop one world into a page. To mount
**several** and control them from the host page, use the **Embed SDK**: one
`createConductor` returns a `Conductor`, and each `conductor.embed(target, spec)`
returns a per-embed handle.

```js
import { createConductor } from "./sdk.js";   // or window.ElCoso.createConductor

const conductor = createConductor({
  runtime: "/embeds/embed.html",               // the guest page
  base: "/embeds/",                             // bundle base: ${base}<id>/<id>-embed.js
  autoplay: { default: true, persist: "coso-autoplay" },
});

const tts = conductor.embed("#slot", { substrate: "tts", config: { speed: "2x" } });
tts.pause();
tts.setTunable("theme", "boomer-blue");
tts.command("rewind", 5);                       // substrate-specific named command
conductor.pauseAll();                           // global autoplay policy
```

Each handle also has `play` / `toggle` / `reset` / `setLoop`, an `on(event, cb)`
for `ready` / `state` / `error`, and `describe()` — the discovery manifest
`{ lens, tunables, commands }` so a host can build controls for whatever the
substrate exposes. **Named commands** (`command(name, ...args)`) are the third
control tier alongside the universal verbs and the tunable channel: a lens
declares its own verbs (an autopilot toggle, a `rewind`) and the SDK forwards
them. Host and guest talk over the `coso/v1` postMessage protocol (origin +
token gated). The full host API is in `src/embed/sdk/`; a worked host page is
`examples/portfolio.html`.

## Preview & debug

`npm run dev` serves the exports so you can try them as deployed:

- **`/portfolio`** — the SDK Conductor demo (`examples/portfolio.html`).
- **`/embeds/*`** — the whole `dist-embed/` tree (`sdk.js`, `embed.html`,
  `<id>/<id>-embed.js`), served verbatim — no HMR injection, so an embed runs
  exactly as it will on a real page.
- **`/embed/<id>`** — a single standalone embed.

Jank in an embed (or the app)? Append **`?profile`** to the URL to turn on the
host loop's frame-cost profiler: it warns in the console the moment a frame's
`tick` or `render` phase blows the budget, naming the phase and substrate.
`?profile=8` sets the budget in ms. Off by default, so it costs nothing in
production.
