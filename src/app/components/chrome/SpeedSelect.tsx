/* Transport speed picker. Same portal pattern as PickerSelect — the
 * popover renders into document.body so it escapes the toolbar's glass
 * stacking context. Visually centered under the trigger button.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import type { SpeedOption } from "@/lib/types";

type Props = {
  speeds: SpeedOption[];
  value: string;
  onChange: (id: string) => void;
};

const POPOVER_OFFSET = 6;
const POPOVER_MIN_WIDTH = 168;

type Rect = { left: number; top: number; bottom: number; width: number };

export function SpeedSelect({ speeds, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function measure(): void {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current =
    speeds.find((s) => s.id === value) ??
    speeds.find((s) => s.isDefault) ??
    speeds[0];

  if (!current) return null;

  const popover = open && rect ? (
    <div
      ref={popoverRef}
      className="glass-heavy"
      style={{
        position: "fixed",
        top: rect.bottom + POPOVER_OFFSET,
        // Center under the trigger by anchoring at the trigger's midpoint
        // and shifting half the popover's min width left.
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%)",
        zIndex: 100,
        minWidth: POPOVER_MIN_WIDTH,
        padding: 4,
        borderRadius: 8,
      }}
    >
      <div className="px-2 py-1 font-mono text-[length:var(--text-2xs)] uppercase tracking-widest text-fg-dim">
        speed · substrate-defined
      </div>
      {speeds.map((s) => {
        const sel = s.id === current.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onChange(s.id);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded font-mono"
            style={{
              padding: "5px 8px",
              fontSize: "var(--text-sm)",
              background: sel ? "var(--accent-tint)" : "transparent",
              color: sel ? "var(--accent)" : "var(--fg)",
              border: "none",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span className="flex items-center gap-1.5">
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: sel ? "var(--accent)" : "transparent",
                  border: sel ? "none" : "1px solid var(--border-2)",
                }}
              />
              {s.label}
            </span>
            <span
              className="text-[length:var(--text-2xs)]"
              style={{ color: sel ? "var(--accent)" : "var(--fg-faint)" }}
            >
              {s.mult >= 1
                ? s.mult.toFixed(s.mult % 1 === 0 ? 0 : 2)
                : String(s.mult)}
              ×{s.isDefault ? " · default" : ""}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost font-mono"
        style={{
          padding: "0 7px",
          height: 26,
          minWidth: 58,
          justifyContent: "center",
          gap: 4,
          color: open ? "var(--fg)" : "var(--fg-muted)",
        }}
        title="Playback speed"
      >
        <span className="text-[length:var(--text-sm)]">{current.label}</span>
        <ChevronDown size={9} />
      </button>
      {popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </>
  );
}
