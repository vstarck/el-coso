/* Spec §17.2 — Help panel. Markdown-fed via marked. */

import { useMemo } from "react";
import { marked } from "marked";
import { CircleHelp, X } from "lucide-react";
import { useStore } from "@/app/store";
import { useDraggablePanel } from "./useDraggablePanel";

const DEFAULT_MD = `# la cosa — help

Substrates evolve, you steer. This panel collects what each control does
and the shortcuts that move you around the history.

## Concepts

- **Substrate** — the system being simulated. Owns its own canvas and rules.
- **Commit** — a snapshot of substrate state + params at a tick.
- **Branch** — a divergent line of commits. Branches don't merge; they're pinned or abandoned.
- **Tick** — substrate time. The unit on the horizontal axis of the timeline.
- **HEAD** — the commit currently rendered on the canvas.

## Transport

| key | action |
| --- | --- |
| <kbd>space</kbd> | toggle play / pause |
| <kbd>,</kbd> / <kbd>.</kbd> | step back / forward one tick |
| <kbd>home</kbd> / <kbd>end</kbd> | seek to first commit / HEAD |
| <kbd>shift</kbd> + drag | scrub the playhead on the timeline |

The **speed selector** to the right of the transport buttons exposes the
playback multipliers your active substrate publishes. Substrates can name
speeds however they like — \`×1/16 → ×16\`, \`glacial → warp\`, etc.

## Timeline tree

A horizontal axis of ticks. Each branch gets its own swim-lane.
Branches diverge as smooth curves from the parent commit.

Two cursors live on the axis:

- **Playhead** (amber) — the current state of the canvas. Dragging it seeks.
- **Scrub** (dashed) — preview-only. Tracks the mouse for tick readout.

**Adaptive folding** collapses long linear runs of commits into a
\`··· N steps ···\` pill. Toggle with the **folded / expanded** button
in the status line below the tree.

### Interactions

- Click a commit node → opens a floating preview card.
- From the preview: **checkout** (load state), **compare**, **branch**, **pin**.
- Click a fold pill to expand the run inline.

## Compare

Open from a preview card or the timeline header. Three modes:

1. **split** — vertical divider, draggable.
2. **wipe** — clipped reveal handle, A → B as you drag.
3. **onion** — B over A with an opacity slider.

Press <kbd>c</kbd> again or click the dim area to close.

## Panels

Every chrome panel is closable. When closed, a small edge stub appears
at the corresponding viewport edge — click to restore.

- **Toolbar** — top edge — run identity, substrate switcher, transport, speed.
- **Inspector** — left rail — selected commit's params diffed against parent.
- **Rules** — right rail — live substrate evolution params.
- **Timeline** — bottom — the BTTF tree itself.

## Rules engine

The right rail edits the substrate's evolution rules in place. While
your changes diverge from HEAD, the rail's header shows
\`● uncommitted\`. Press <kbd>⌘</kbd><kbd>↵</kbd> to commit, creating a
new node on the active branch.

## Theme

Toggle dark / light from the toolbar. Choice is remembered locally.

## Kitchen Sink

The beaker icon opens a reference panel with every UI primitive used
in la cosa, mapped to its shadcn/ui equivalent. Useful while wiring
the design to your component library.

---

> Need more? Drop docs into your project's \`docs/\` folder and feed
> the markdown into this panel — it just renders what you pass it.
`;

type Props = {
  markdown?: string;
};

export function HelpPanel({ markdown }: Props) {
  const open = useStore((s) => s.helpOpen);
  const toggleHelp = useStore((s) => s.toggleHelp);
  const { panelRef, startDrag, pos } = useDraggablePanel();

  const html = useMemo(() => {
    marked.setOptions({ gfm: true, breaks: false });
    return marked.parse(markdown ?? DEFAULT_MD) as string;
  }, [markdown]);

  if (!open) return null;

  const positionStyle: React.CSSProperties =
    pos.x === null || pos.y === null
      ? { right: 16, top: 76 }
      : { left: pos.x, top: pos.y };

  return (
    <div
      ref={panelRef}
      className="glass-heavy pointer-events-auto"
      style={{
        position: "fixed",
        zIndex: 50,
        width: 460,
        maxHeight: "calc(100vh - 100px)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        ...positionStyle,
      }}
    >
      {/* Header */}
      <div
        onMouseDown={startDrag}
        style={{
          cursor: "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-2">
          <CircleHelp size={13} className="text-fg-muted" />
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
            help
          </div>
          <span className="chip font-mono">markdown</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[length:var(--text-xs)] text-fg-faint">marked.js</span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22, marginLeft: 6 }}
            onClick={toggleHelp}
            aria-label="Close help"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className="md"
        style={{ overflow: "auto", padding: "14px 18px" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Footer */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "Geist Mono",
          fontSize: "var(--text-xs)",
          color: "var(--fg-faint)",
        }}
      >
        <span>feed me a markdown string</span>
        <span>drag header to move</span>
      </div>
    </div>
  );
}
