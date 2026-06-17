import { Moon, Settings, Sun, X } from "lucide-react";
import {
  FONT_SCALES,
  FPS_CAPS,
  UI_SCALES,
  useStore,
  type FontScale,
  type FpsCap,
  type UiScale,
} from "@/app/store";
import { useDraggablePanel } from "./useDraggablePanel";

export function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const uiScale = useStore((s) => s.uiScale);
  const setUiScale = useStore((s) => s.setUiScale);
  const fontScale = useStore((s) => s.fontScale);
  const setFontScale = useStore((s) => s.setFontScale);
  const fpsCap = useStore((s) => s.fpsCap);
  const setFpsCap = useStore((s) => s.setFpsCap);
  const { panelRef, startDrag, pos } = useDraggablePanel();

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
        width: 360,
        maxHeight: "calc(100vh - 100px)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        ...positionStyle,
      }}
    >
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
          <Settings size={13} className="text-fg-muted" />
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
            settings
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          style={{ width: 22, height: 22 }}
          onClick={toggleSettings}
          aria-label="Close settings"
        >
          <X size={11} />
        </button>
      </div>

      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Section label="theme">
          <SegmentedGroup>
            <SegmentedButton
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              icon={<Moon size={12} />}
              label="dark"
            />
            <SegmentedButton
              active={theme === "light"}
              onClick={() => setTheme("light")}
              icon={<Sun size={12} />}
              label="light"
            />
          </SegmentedGroup>
        </Section>

        <Section label="font size" hint="text only, layout stays put">
          <SegmentedGroup>
            {FONT_SCALES.map((s) => (
              <SegmentedButton
                key={s}
                active={fontScale === s}
                onClick={() => setFontScale(s as FontScale)}
                label={`${Math.round(s * 100)}%`}
              />
            ))}
          </SegmentedGroup>
        </Section>

        <Section label="ui scale" hint="scales fonts and layout together">
          <SegmentedGroup>
            {UI_SCALES.map((s) => (
              <SegmentedButton
                key={s}
                active={uiScale === s}
                onClick={() => setUiScale(s as UiScale)}
                label={`${Math.round(s * 100)}%`}
              />
            ))}
          </SegmentedGroup>
        </Section>

        <Section label="fps cap" hint="render ceiling; tick rate is real-time">
          <SegmentedGroup>
            {FPS_CAPS.map((c) => (
              <SegmentedButton
                key={c}
                active={fpsCap === c}
                onClick={() => setFpsCap(c as FpsCap)}
                label={c === 0 ? "uncapped" : String(c)}
              />
            ))}
          </SegmentedGroup>
        </Section>
      </div>

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
        <span>persisted to localStorage</span>
        <span>drag header to move</span>
      </div>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
          {label}
        </div>
        {hint && (
          <div className="text-[length:var(--text-xs)] text-fg-faint">{hint}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function SegmentedGroup({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 3,
        background: "var(--field-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}

function SegmentedButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn"
      style={{
        flex: 1,
        height: 28,
        justifyContent: "center",
        background: active ? "var(--accent-tint)" : "transparent",
        borderColor: active ? "var(--accent-edge)" : "transparent",
        color: active ? "var(--accent)" : "var(--fg-muted)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
