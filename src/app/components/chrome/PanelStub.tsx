type Edge = "top" | "left" | "right" | "bottom";

type Props = {
  edge: Edge;
  label: string;
  onClick: () => void;
};

const EDGE_CLASSES: Record<Edge, string> = {
  top: "rounded-b-[10px] rounded-t-none h-7 px-3",
  bottom: "rounded-t-[10px] rounded-b-none h-7 px-3",
  left: "rounded-r-[10px] rounded-l-none w-7 py-3",
  right: "rounded-l-[10px] rounded-r-none w-7 py-3",
};

export function PanelStub({ edge, label, onClick }: Props) {
  const isVertical = edge === "left" || edge === "right";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-med pointer-events-auto flex items-center justify-center font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted transition-colors hover:text-fg ${EDGE_CLASSES[edge]}`}
      style={isVertical ? { writingMode: "vertical-rl" } : undefined}
      aria-label={`Restore ${label} panel`}
    >
      {label}
    </button>
  );
}
