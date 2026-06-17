# Embedding tts

`tts` exports to a self-contained, React-free widget. Build it with:

```
npm run export -- tts
```

This writes two files to `dist-embed/`:

| File | What it is |
|------|------------|
| `tts.html` | A standalone page — open it directly, or drop it in an `<iframe>`. JS + CSS are inlined; the mount config is baked in. |
| `tts-embed.js` | The reusable bundle (~26 KB / ~10 KB gzipped, no React/zustand). Include it on your own page and mount manually. |

## Option A — iframe the standalone file

The simplest path. The page sizes itself and self-plays on load.

```html
<iframe src="tts.html" style="width:640px; height:560px; border:0;"></iframe>
```

## Option B — mount the JS into your own element

Include `tts-embed.js`; it exposes a global `CosoEmbed` with a `mount` function.

```html
<div id="tts"></div>
<script src="tts-embed.js"></script>
<script>
  CosoEmbed.mount(document.getElementById("tts"), {
    // every field is optional — these are the defaults
    autoplay: true,
    tunables: {
      theme: "default",   // default | boomer-blue | modern
      font_size: 15,      // px
    },
  });
</script>
```

`mount(target, config)` returns a handle with `destroy()` for teardown.
`target` is an element or a CSS selector.

### Config

| Field | Default | Notes |
|-------|---------|-------|
| `autoplay` | `true` | Start the clock on mount. |
| `seed` | level's | RNG seed — fixes the piece sequence (and the autopilot, which is deterministic). |
| `speed` | `1x` | `0.5x` / `1x` / `2x` / `4x`. |
| `tunables.theme` | `default` | The whole look in one entity — text color + terminal background + CRT on/off. One of `default` (green phosphor, CRT), `boomer-blue` (white on DOS blue, CRT), `modern` (grey on charcoal, no CRT). |
| `tunables.font_size` | `15` | Readout font size in px. |

The same options can be **baked into the export** instead of passed at mount:

```
npm run export -- tts --set theme=modern --set font_size=24 --speed=2x
```

## Behaviour

- **Self-plays on load** via a paced, deterministic autopilot (the feed-post
  default). The readout is a live JSON view of the game state.
- **Click a sandbox to interact.** Keyboard is scoped to the focused widget
  (see below). Then:
  - **◀ ▶** move · **▲** rotate · **▼ / Space** drop.
  - Type a command at the prompt + Enter: `auto` (toggle self-play),
    `restart`, `pause`, `play` / `unpause`, `rewind N` (take back N pieces,
    keeps the pause/auto state), `theme NAME` (`default` / `boomer-blue` /
    `modern`), `help`.

## Multiple widgets on one page

Keyboard is **element-scoped**, not global: each widget listens on its own
focusable screen and only responds while focused, so several `tts` embeds can
share a page without trading keystrokes. The focused widget's wrapper gets a
**`tts-focused`** class — style the active one however you like:

```css
.tts-crt-screen.tts-focused { box-shadow: 0 0 0 1px #33ff66; }
```
