import { useLayoutEffect } from "react";
import { SubstrateHost } from "./components/canvas/SubstrateHost";
import { Toolbar } from "./components/chrome/Toolbar";
import { InspectorRail } from "./components/chrome/InspectorRail";
import { RulesRail } from "./components/chrome/RulesRail";
import { PanelStub } from "./components/chrome/PanelStub";
import { CompareOverlay } from "./components/chrome/CompareOverlay";
import { PreviewCard } from "./components/chrome/PreviewCard";
import { HelpPanel } from "./components/overlays/HelpPanel";
import { KitchenSink } from "./components/overlays/KitchenSink";
import { SettingsPanel } from "./components/overlays/SettingsPanel";
import { OutcomeDialog } from "./components/overlays/OutcomeDialog";
import { TimelinePanel } from "./components/timeline/TimelinePanel";
import { applyLensTheme } from "@/lib/accentTheme";
import { useKeyboard } from "./lib/useKeyboard";
import { session } from "./session";
import { useStore } from "./store";
import {
  GAP,
  INSPECTOR_W,
  PAD,
  RULES_W,
  TIMELINE_H,
  TOOLBAR_H,
} from "./layout";

export default function App() {
  useKeyboard();
  const panels = useStore((s) => s.panels);
  const availablePanels = useStore((s) => s.availablePanels);
  const togglePanel = useStore((s) => s.togglePanel);

  // Lens-declared accent: re-apply on theme flip OR substrate switch.
  // useLayoutEffect to write the CSS vars before the browser paints, so
  // the first frame after a switch shows the new accent (no amber
  // flash). session.active_lens is read fresh because bumpSession has
  // already swapped it by the time this effect runs.
  const theme = useStore((s) => s.theme);
  const sessionVersion = useStore((s) => s.sessionVersion);
  useLayoutEffect(() => {
    applyLensTheme(session.active_lens, theme);
  }, [theme, sessionVersion]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SubstrateHost />

      <div className="pointer-events-none absolute inset-0">
        {/* ── Toolbar / top stub ─────────────────────────────────────── */}
        {availablePanels.toolbar &&
          (panels.toolbar ? (
            <div
              className="pointer-events-auto absolute"
              style={{ top: PAD, left: PAD, right: PAD, height: TOOLBAR_H }}
            >
              <Toolbar onClose={() => togglePanel("toolbar")} />
            </div>
          ) : (
            <div className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2">
              <PanelStub
                edge="top"
                label="toolbar · transport"
                onClick={() => togglePanel("toolbar")}
              />
            </div>
          ))}

        {/* ── Inspector / left stub ──────────────────────────────────── */}
        {availablePanels.inspector &&
          (panels.inspector ? (
            <div
              className="pointer-events-auto absolute"
              style={{
                top: PAD + TOOLBAR_H + GAP,
                bottom: PAD + TIMELINE_H + GAP,
                left: PAD,
                width: INSPECTOR_W,
              }}
            >
              <InspectorRail onClose={() => togglePanel("inspector")} />
            </div>
          ) : (
            <div className="pointer-events-auto absolute left-0 top-1/2 -translate-y-1/2">
              <PanelStub
                edge="left"
                label="inspector"
                onClick={() => togglePanel("inspector")}
              />
            </div>
          ))}

        {/* ── Rules / right stub ─────────────────────────────────────── */}
        {availablePanels.rules &&
          (panels.rules ? (
            <div
              className="pointer-events-auto absolute"
              style={{
                top: PAD + TOOLBAR_H + GAP,
                right: PAD,
                width: RULES_W,
                maxHeight: `calc(100% - ${PAD + TOOLBAR_H + GAP + TIMELINE_H + GAP + PAD}px)`,
              }}
            >
              <RulesRail onClose={() => togglePanel("rules")} />
            </div>
          ) : (
            <div className="pointer-events-auto absolute right-0 top-1/2 -translate-y-1/2">
              <PanelStub
                edge="right"
                label={`rules · ${session.active_lens.name.toLowerCase()}`}
                onClick={() => togglePanel("rules")}
              />
            </div>
          ))}

        {/* ── Timeline / bottom stub ─────────────────────────────────── */}
        {availablePanels.timeline &&
          (panels.timeline ? (
            <div
              className="pointer-events-auto absolute"
              style={{ left: PAD, right: PAD, bottom: PAD, height: TIMELINE_H }}
            >
              <TimelinePanel onClose={() => togglePanel("timeline")} />
            </div>
          ) : (
            <div className="pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2">
              <PanelStub
                edge="bottom"
                label="history · timeline"
                onClick={() => togglePanel("timeline")}
              />
            </div>
          ))}
      </div>

      <PreviewCard />
      <CompareOverlay />
      <HelpPanel />
      <SettingsPanel />
      <KitchenSink />
      <OutcomeDialog />
    </div>
  );
}
