# Embeddable substrates

Export any substrate as a single self-contained `<script>` / standalone HTML —
no React, no app chrome, no network dependencies, no style leakage — ready to
drop into a web page or a feed post.

## Export

```bash
npm run export -- <substrate-id> [options]
```

Produces two files in `dist-embed/<id>/`:

- **`<id>.html`** — a self-contained page (JS + CSS inlined, config baked in).
  Double-click to play, host anywhere, screen-record, or `<iframe src>` into a
  post.
- **`<id>-embed.js`** — the reusable IIFE bundle (`<script src>` + a mount call).

Options — every tunable aspect of the run is setupable here:

| option | meaning |
|---|---|
| `--puzzle=<id>` | which puzzle to load (default: the substrate's default) |
| `--lens=<id>` | which lens to mount (default: the substrate's default) |
| `--seed=<n>` | RNG seed (deterministic) |
| `--speed=<id>` | speed preset id (one of the lens's `speeds`) |
| `--no-autoplay` | mount paused |
| `--set <name>=<val>` | set a tunable (repeatable; `val` coerces bool/number) |
| `--title=<text>` | page `<title>` |
| `--js-only` | emit only the `.js`, skip the `.html` |
| `--skip-typecheck` | skip the `tsc --noEmit` gate |

```bash
npm run export -- conway --puzzle=glider --speed=4x --set show_tick_counter=false
```

## How it stays React-free

The pipeline is built on a **store-free, React-free host** (`@/lib/lens-host/`):

- `mountHost(container, lens, history, opts)` — the chrome-less twin of the
  app's `SubstrateHost`: `mountLensTree` + `attachRafLoopCore` + the
  feature-aware layout, driven by a `LensHost` instead of the Zustand store.
- `makeLensHost()` — a ~40-line store-free observable implementing the
  `LensHost` seam (transport + head-change notification). The app has a mirror
  `storeLensHost` that delegates to Zustand so chrome keeps re-rendering.
- `mountSubstrate(target, substrateModule, config)` (`src/embed/mount-substrate.ts`)
  — the generic, **registry-free** mount: it takes one substrate *barrel*, never
  the app registry, so an export bundle pulls in only the substrate it targets.

A substrate exports React-free **once its lenses use the `LensHost` seam** —
i.e. they call `args.host.setPlaying(…)` / `args.host.bumpHistoryVersion()` etc.
instead of importing `@/app/store`. Migrating a lens is mechanical (swap the
`useStore.getState().X` calls for `args.host.*`, drop the import). Until a
substrate is migrated, its export still works but pulls React via the unmigrated
lens. Migrated so far: **conway**; **blockoide** (via its bespoke entry, below).

## Blockoide — the bespoke entry

Blockoide predates the generic pipeline: it has a hand-written react-less embed
(`src/embed/blockoide.ts`) wrapping its composite **deck** lens, with an
autopilot that plays the board on its own (the feed-post default — a human
keypress hands control back). `npm run export -- blockoide` builds from that
entry; `npm run build:embed` is the original standalone build of the same.

Controls (manual play): arrows move, `Q E / A D / W S` rotate the three axes,
`Shift` soft drop, `Enter` hard drop. The in-frame buttons cover play/pause,
autopilot, rewind, restart, view-swap (shaft / pit / well), and credits.

Setupable knobs (via `--set`, forwarded to the deck):

| `--set …` | effect |
|---|---|
| `theme=<classic\|shaded\|matrix\|amber\|ice>` | shaft color/glyph theme |
| `center=<shaft\|pit\|well>` | which center view is active |
| `show_titlebar=false` | hide the title logo |
| `show_altimeter=false` | hide the depth gauge |
| `show_stats=false` | hide the stats + NEXT column |
| `show_transport=false` | hide the play/auto/rewind buttons |
| `show_keyhints=false` | hide the footer key-hint line |

```bash
# a clean, minimal, matrix-themed autoplaying loop for a feed post
npm run export -- blockoide --set theme=matrix \
  --set show_keyhints=false --set show_stats=false --set show_altimeter=false
```

## Use the JS bundle directly

```html
<div id="app"></div>
<script src="conway-embed.js"></script>
<script>
  // generic: window.CosoEmbed.mount(target, config)
  CosoEmbed.mount("#app", { puzzle: "glider", speed: "4x" });
  // blockoide: window.Blockoide.mountBlockoide(target, opts)
</script>
```

Both mount functions return `{ destroy() }`.

## Dev preview

`npm run dev`, then open `/src/embed/blockoide.html` (the blockoide bespoke
embed, through Vite — co-located with its entry). For any exported substrate,
open the generated `dist-embed/<id>/<id>.html` directly.

## SDK Conductor demo

`examples/portfolio.html` is a maintained host page that mounts embeds with the
public **Embed SDK** (`src/embed/sdk/`, spec/25): one `createConductor`, per-embed
controls, named commands, and a global autoplay policy. Export at least `tts` and
`conway` (`npm run export -- tts && npm run export -- conway`), run `npm run dev`,
then open **`/portfolio`**. The dev server serves the whole `dist-embed/` tree at
`/embeds/*` (verbatim — no HMR injection), so the demo runs exactly as deployed.
It shows the imperative pattern; the declarative `data-coso` + `conductor.enhance()`
form is a one-step derivation.
