# dvd-screensaver

A technical demo and visual guide to Verlet integration, built to showcase
**dynamic lens composition**. A single particle bounces in a continuous box
(autonomous — no input). The registered lens is a composite:

```
dvd-space (root)         bouncing particle + trail; owns tick + orchestration
├─ dvd-velocity          pos − prev          (green arrow)
├─ dvd-acceleration      field accel          (red arrow)
├─ dvd-jitter            stochastic residual  (purple shimmer)
├─ dvd-projection        naive ballistic ray  (cyan dotted line)
└─ dvd-hud               top-right toggles    (view-state only)
```

The Verlet State stores only `pos` + `prev_pos`; every overlay is a pure
function of those two positions — *no magic, every view is a reasonable
composition of states.* The HUD owns the four visibility flags; the root
subscribes to it and forwards each to the matching overlay via `setTunable`
(siblings coordinate through the parent). Toggling is a view change and never
touches the substrate.

This is the second composing-lens instance and the first to use
`LensMountArgs.children`, with a `ProjectionStrategy` seam.
