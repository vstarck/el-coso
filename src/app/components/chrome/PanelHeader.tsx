import { X } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  label: ReactNode;
  trailing?: ReactNode | undefined;
  onClose?: (() => void) | undefined;
};

export function PanelHeader({ label, trailing, onClose }: Props) {
  return (
    <div className="flex h-9 items-center justify-between border-b border-[var(--border)] px-3">
      <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.1em] text-fg-faint">
        {label}
      </div>
      <div className="flex items-center gap-2">
        {trailing}
        {onClose && (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close panel"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
