# Embedding el coso

Any substrate exports as a **self-contained, React-free** widget you can drop
into any page — a portfolio, a feed, a blog post. One file is enough for a single
world; the **Embed SDK** mounts and controls many from the host page, and keeps
your own controls (play/pause, an autopilot toggle, a theme picker, a terminal
toggle) **in sync** with whatever the substrate does on its own.

This is the integration guide. For authoring substrates/lenses, see
[`guide.md`](guide.md).

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
scaffolded by the wizard), so the bundle carries no React or store. `conway` and
`tts` come out at a few kilobytes.

## Drive many embeds — the SDK

A self-contained `<id>.html` is enough to drop one world into a page. To mount
**several** and control them from the host page, use the **Embed SDK**: one
`createConductor` returns a `Conductor`, and each `conductor.embed(target, spec)`
returns a per-embed `EmbedRemote`.

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

Each `EmbedRemote` has `play` / `pause` / `toggle` / `reset` / `setLoop`,
`setTunable(path, value)`, `command(name, …args)`, and an `on(event, cb)` for
`ready` / `state` / `error`. Host and guest talk over the `coso/v1` postMessage
protocol (origin + token gated). The conductor itself owns a **global autoplay
policy** (`setAutoplay` / `toggleAutoplay`, persisted to `localStorage`) that
late-loading `loading="lazy"` embeds pick up correctly via a ready handshake. The
full host API is in `src/embed/sdk/`; a worked host page is
`examples/portfolio.html`.

### The three control tiers

A host reaches an embed at increasing specificity, all over the same protocol:

1. **Universal verbs** — `play` / `pause` / `toggle` / `reset` / `setLoop`, on
   every embed.
2. **Tunables** — `setTunable(path, value)`; the declared knobs (theme, a
   self-play toggle, counters). Discovered via the manifest (below).
3. **Named commands** — `command(name, …args)` → the lens's own verbs (a
   `rewind`, a `spawn`). Declared by the lens; the SDK forwards them.

## Live controls & state sync

To render *your own* toolbar — a play button, an autopilot toggle, a theme
picker — you need two things: **what controls to show** and **their current
values, kept live**.

**What to show — the manifest.** `remote.describe()` returns
`{ lens, tunables, commands }` once the guest has mounted (and is the payload of
the `ready` event). `tunables` is the declared list (path, label, type, range /
options); `commands` is the named-verb list. Render a control per entry.

**Current values, kept live — the `state` event.** The guest pushes a **state
snapshot** whenever play-state *or any tunable* changes — including changes the
substrate makes *itself* (the visitor takes over from autopilot, opens the
console with a keypress, a `set` typed into the terminal). You don't diff it or
ask for it back; you **apply** it:

```js
const remote = conductor.embed("#slot", { substrate: "tts" });

remote.on("ready", ({ tunables, commands }) => buildControls(tunables, commands));
remote.on("state", ({ playing, tunables }) => {
  pauseButton.pressed = playing;
  autoToggle.on       = tunables.autopilot;        // a bool tunable
  themePicker.value   = tunables.theme;            // an enum tunable
});
```

`tunables` is a full snapshot keyed by dotted path; apply it idempotently (a
late-joining or re-synced control just gets the whole picture). `remote.isPlaying()`
and `remote.tunables()` read the last known values without waiting for an event.

This is why a synced *toggle* binds to a **tunable**, not a command: a command is
fire-and-forget (no value to read, no change to observe), whereas a tunable has
get / set / subscribe — exactly what a toggle that reflects state needs. A
substrate that wants its self-play toggle synced declares `autopilot` as a bool
tunable (tts does); the host then sets it with `setTunable("autopilot", false)`
and reads it from each `state` snapshot.

### Toggling the terminal

Substrates that adopt the guake command console (conway, tfps, tts, …) expose its
open/closed state as a `console_open` **bool tunable**, so a host toolbar can add
a terminal toggle with no special API — it's just another tunable:

```js
// a `>` button in your toolbar
termButton.onclick = () => remote.setTunable("console_open", !remote.tunables().console_open);
remote.on("state", ({ tunables }) => { termButton.pressed = tunables.console_open; });
```

Opening the console with the backtick key flips `console_open` too, so the button
stays in sync either way. (An always-on inline terminal — e.g. a substrate that
*is* a terminal session — has no open/closed state and no `console_open`.)

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

Want the numbers on screen instead? Append **`?fps`** to any embed (or
bare.html) URL for a corner overlay reading **instant / average-total /
average-10s / min-10s** fps — the last is the worst single frame in the window,
which catches hitches an average smears away. The app chrome shows the same four
in its toolbar. Like `?profile`, it's off by default and computed in the shared
host loop, so the app and the export embeds report identical numbers — measure
performance in place on the real page. (`globalThis.__COSO_FPS__` is the non-URL
gate.)
