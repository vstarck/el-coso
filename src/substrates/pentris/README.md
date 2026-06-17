# pentris

Executable authoring template. A registered, type-checked, kit-
exercising substrate that the design-questions pipeline (see
[`docs/guide.md`](../../../docs/guide.md#scaffold-a-new-substrate) *The design-
questions pipeline*) is exercised against.

To add a new substrate, copy this directory:

```bash
cp -r src/substrates/pentris src/substrates/<name>
```

Then walk the six questions in `docs/guide.md`:

1. **Q1** — what does the substrate render onto? (canvas2d /
   webgl / dom / ascii)
2. **Q2** — how does the viewport relate to the world?
   (full-bleed default / `FLAT` / `BOUNDED` / `SAFE_AREA`)
3. **Q3** — storage shape: dense + hot-path (channels) vs. sparse
   + event-driven (plain objects); fixed vs. dynamic population.
4. **Q4** — how does the player act (Agency)? none / continuous-held
   (`attachKeyControls`) / discrete-event / spatial-stamp
   (`attachBrush`); shapes `Inputs` + `Cadence.bias_apply`.
5. **Q5** — substrate pace: `AUTOPLAY` (rAF drives ticks),
   render-only (rAF for redraws but no tick), or event-driven
   (tick on input, no rAF).
6. **Q6** — commit shape: per-tick / per-event / per-input.

Each kit-helper import in this package is flagged with a `Q1`–`Q6`
comment pointing back to the answer it represents. Use those as
guideposts when adapting the template.

## Registration

After copying:

1. Edit `src/substrates/<name>/index.ts` to project the package
   barrel (`bundle`, `adapter`, `lens`, `parseLevel`, `puzzles`,
   `meta`).
2. Add a namespace import and `SUBSTRATES` entry in
   `src/app/substrates.ts`:
   ```ts
   import * as MyName from "../substrates/<name>";
   ```
3. Run `npm run typecheck`; the registry will fail with the exact
   missing field if the barrel is incomplete.
