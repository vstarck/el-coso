/* Generic substrate-style dropdown picker. Visual language matches
 * SpeedSelect (chevron-trigger button + glass-heavy popover). The popover
 * is portaled to document.body so it escapes the toolbar's stacking
 * context (the toolbar's `.glass-light` backdrop-filter would otherwise
 * trap it). Position is computed from the trigger button's
 * bounding rect and refreshed on scroll/resize while open.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export type PickerItem = {
  id: string;
  label: string;
  description?: string;
};

type Props = {
  items: PickerItem[];
  value: string;
  onChange: (id: string) => void;
  title?: string;
  // Optional decoration drawn to the left of the label in the trigger
  // button (e.g. a colored chip dot). Same node is repeated in the open
  // list rows for the currently-selected item.
  leftAdornment?: ReactNode;
  minTriggerWidth?: number;
  popoverMinWidth?: number;
  sectionLabel?: string;
};

const POPOVER_OFFSET = 6;

type Rect = { left: number; top: number; bottom: number; width: number };

export function PickerSelect({
  items,
  value,
  onChange,
  title,
  leftAdornment,
  minTriggerWidth = 96,
  popoverMinWidth = 240,
  sectionLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Measure the trigger before paint when opening so the popover lands at
  // the right coordinates on the first frame.
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
    // capture: true so scrolls inside any ancestor still refresh us.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // Click-outside to close. The popover is portaled to body, so we have
  // to check both the trigger AND the popover before treating an event
  // as "outside".
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

  const current = items.find((s) => s.id === value) ?? items[0];
  if (!current) return null;

  const popover = open && rect ? (
    <div
      ref={popoverRef}
      className="glass-heavy"
      style={{
        position: "fixed",
        top: rect.bottom + POPOVER_OFFSET,
        left: rect.left,
        zIndex: 100,
        minWidth: popoverMinWidth,
        padding: 4,
        borderRadius: 8,
      }}
    >
      {sectionLabel && (
        <div className="px-2 py-1 font-mono text-[length:var(--text-2xs)] uppercase tracking-widest text-fg-dim">
          {sectionLabel}
        </div>
      )}
      {items.map((item) => {
        const sel = item.id === current.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onChange(item.id);
              setOpen(false);
            }}
            className="flex w-full flex-col items-start rounded"
            style={{
              padding: "6px 8px",
              fontSize: "var(--text-sm)",
              background: sel ? "var(--accent-tint)" : "transparent",
              color: sel ? "var(--accent)" : "var(--fg)",
              border: "none",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span className="flex items-center gap-1.5 font-mono">
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: sel ? "var(--accent)" : "transparent",
                  border: sel ? "none" : "1px solid var(--border-2)",
                }}
              />
              {item.label}
            </span>
            {item.description && (
              <span
                className="font-mono text-[length:var(--text-xs)] leading-snug"
                style={{
                  paddingLeft: 14,
                  color: sel ? "var(--accent)" : "var(--fg-faint)",
                }}
              >
                {item.description}
              </span>
            )}
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
        className="btn btn-ghost"
        style={{ gap: 6, minWidth: minTriggerWidth }}
        title={title}
      >
        {leftAdornment}
        <span className="font-mono">{current.label}</span>
        <ChevronDown size={10} />
      </button>
      {popover && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </>
  );
}
