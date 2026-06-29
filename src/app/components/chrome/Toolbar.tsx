/* Spec §8 — top toolbar. Single 44px row, items-stretch, children that need
   natural 26px height wrapped in flex-items-center. */

import { useState } from "react";
import {
  Beaker,
  Braces,
  Camera,
  Check,
  CircleHelp,
  Eraser,
  ExternalLink,
  Eye,
  FastForward,
  Moon,
  Pause,
  Play,
  Rewind,
  Settings,
  SkipForward,
  Sun,
  Swords,
  X,
} from "lucide-react";
import { hasFeature } from "@/lenses/types";
import { hudIcon } from "@/app/hudIcons";
import { goBackToCommit } from "@/app/lib/bttf";
import { captureState } from "@/app/lib/captureState";
import { isSceneChild } from "@/app/lib/scenes/scene-stack";
import {
  chromePanelsFor,
  session,
  setLens,
  setPuzzle,
  setSubstrate,
} from "@/app/session";
import { SUBSTRATE_BY_ID, SUBSTRATES } from "@/app/substrates";
import { useStore } from "@/app/store";
import { PickerSelect, type PickerItem } from "./PickerSelect";
import { SpeedSelect } from "./SpeedSelect";

export function Toolbar({ onClose }: { onClose?: () => void }) {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const playing = useStore((s) => s.playing);
  const togglePlaying = useStore((s) => s.togglePlaying);
  const playheadTick = useStore((s) => s.playheadTick);
  const fps = useStore((s) => s.fps);
  const speedId = useStore((s) => s.speedId);
  const setSpeedId = useStore((s) => s.setSpeedId);
  const toggleKitchenSink = useStore((s) => s.toggleKitchenSink);
  const toggleHelp = useStore((s) => s.toggleHelp);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const triggerSnapshot = useStore((s) => s.triggerSnapshot);

  // State dump — copy the raw substrate State (the data every lens renders
  // from) as JSON. Transient checkmark confirms the clipboard write.
  const [stateCaptured, setStateCaptured] = useState(false);
  const captureSubstrateState = async () => {
    const result = await captureState(session.history.substrate.read);
    if (result === "copied") {
      setStateCaptured(true);
      setTimeout(() => setStateCaptured(false), 1200);
    }
  };
  // Subscribed so the trigger button labels + puzzle list re-render after
  // bumpSession swaps session.active_substrate_id under us. sceneVersion is
  // the same kind of subscription for scene push/pop (which projects a
  // different active frame through `session`).
  const sessionVersion = useStore((s) => s.sessionVersion);
  const sceneVersion = useStore((s) => s.sceneVersion);
  const bumpSession = useStore((s) => s.bumpSession);
  const bumpSessionLensOnly = useStore((s) => s.bumpSessionLensOnly);
  const applyChromePanels = useStore((s) => s.applyChromePanels);

  // Suppress eslint — these are the subscriptions, even though we read
  // session.active_substrate_id directly afterwards.
  void sessionVersion;
  void sceneVersion;

  // While a spawned child scene is active, the parent world is suspended.
  // Swapping substrate/puzzle/lens then would discard it (setSubstrate
  // resets the scene stack), and the synthetic scene puzzle id isn't in the
  // child's authored list — so the pickers give way to a read-only marker.
  const inScene = isSceneChild();

  const substrateId = session.active_substrate_id;
  const puzzleId = session.active_puzzle_id;
  const lensId = session.active_lens_id;
  const activeSubstrate = SUBSTRATE_BY_ID[substrateId]!;
  const activeLens = session.active_lens;

  const substrateItems: PickerItem[] = SUBSTRATES.map((s) => ({
    id: s.id,
    label: s.name.toLowerCase(),
    description: s.lenses[s.defaultLensId]!.name,
  }));
  const puzzleItems: PickerItem[] = activeSubstrate.puzzles.map((p) =>
    p.description
      ? { id: p.id, label: p.id, description: p.description }
      : { id: p.id, label: p.id },
  );
  // Per-substrate lens dropdown. Hidden when the substrate has
  // only one lens — most substrates ship a single lens.
  const lensItems: PickerItem[] = Object.entries(activeSubstrate.lenses).map(
    ([id, lens]) => ({ id, label: lens.name.toLowerCase() }),
  );
  const showLensPicker = lensItems.length > 1;

  function onSubstrateChange(id: string): void {
    if (!setSubstrate(id)) return;
    const newDefault = session.active_lens.speeds.find((s) => s.isDefault)?.id
      ?? session.active_lens.speeds[0]?.id
      ?? "1x";
    setSpeedId(newDefault);
    // Re-apply the new substrate's chrome panel defaults. A substrate switch
    // re-establishes its preferred layout; runtime toggles don't carry over.
    applyChromePanels(chromePanelsFor(session.active_substrate_id));
    bumpSession();
  }

  function onPuzzleChange(id: string): void {
    if (!setPuzzle(id)) return;
    bumpSession();
  }

  function onLensChange(id: string): void {
    if (!setLens(id)) return;
    // New lens may not have the same speed set — fall back to its default.
    const newDefault = session.active_lens.speeds.find((s) => s.isDefault)?.id
      ?? session.active_lens.speeds[0]?.id
      ?? "1x";
    setSpeedId(newDefault);
    // History is preserved across a lens swap; use the lens-only bump so
    // the playhead stays at head_tick. Otherwise the tick driver enters
    // replay mode for head_tick ticks and drops queued biases.
    bumpSessionLensOnly();
  }

  function onSpeedChange(id: string): void {
    setSpeedId(id);
    session.mounted_lens?.setSpeed(id);
  }

  function onStepForward(): void {
    session.mounted_lens?.step();
  }

  function onRewindToStart(): void {
    // Go to the root branch's tick 0. The root branch is the only branch
    // where fork_tick === 0, so it always contains the run origin.
    const h = session.history;
    const rootId = h.root_branch_id;
    goBackToCommit({ branchId: rootId, tick: 0 });
  }

  function onFastForwardToHead(): void {
    // Jump to the active branch's head_tick. Play/pause state is preserved
    // (navigation is orthogonal to transport — see bttf `finalize`): if the
    // loop is running the lens replay-mode loop (see conway's doOneTick)
    // walks the substrate forward; if paused, it rests at head.
    const h = session.history;
    const active = h.branches[h.active];
    if (!active) return;
    goBackToCommit({ branchId: active.id, tick: active.head_tick });
  }

  const canAutoplay = hasFeature(activeLens, "AUTOPLAY");
  // A lens that lets the player place biases may also expose the withdraw
  // gesture (teach-and-withdraw): drop the player's placed biases and watch
  // whether the substrate sustains the structure on its own.
  const canWithdraw = !!session.mounted_lens?.clearBiases;

  function onWithdraw(): void {
    session.mounted_lens?.clearBiases?.();
  }

  return (
    <div
      className="glass-light flex items-stretch"
      style={{ height: 44, padding: 4, gap: 4, borderRadius: 12 }}
    >
      {/* Identity */}
      <div className="flex items-center pl-2 pr-3">
        <div className="font-mono text-[length:var(--text-base)] font-semibold tracking-tight">
          la·cosa
        </div>
      </div>

      <Divider />

      {/* Substrate switcher — a read-only scene marker while a child scene
          is active (the parent world is suspended; auto-returns on terminal). */}
      <div className="flex items-center gap-1">
        {inScene ? (
          <div
            className="flex items-center gap-2 rounded-md px-2.5"
            style={{ height: 26, background: "var(--surface-2)", border: "1px solid var(--border)" }}
            title="A scene is running — the world is suspended and resumes when it ends"
          >
            <Swords size={12} className="text-fg-muted" />
            <span className="font-mono text-[length:var(--text-sm)] text-fg">
              {activeSubstrate.name.toLowerCase()}
            </span>
            <span
              className="chip font-mono uppercase"
              style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
            >
              scene
            </span>
          </div>
        ) : (
          <>
            <PickerSelect
              items={substrateItems}
              value={substrateId}
              onChange={onSubstrateChange}
              title="Substrate"
              leftAdornment={
                <span className="chip-dot" style={{ background: "var(--accent)" }} />
              }
              minTriggerWidth={108}
              popoverMinWidth={208}
              sectionLabel="substrate · runs the universe"
            />
            <PickerSelect
              items={puzzleItems}
              value={puzzleId}
              onChange={onPuzzleChange}
              title="Puzzle"
              minTriggerWidth={108}
              popoverMinWidth={280}
              sectionLabel="puzzle · initial conditions"
            />
            {showLensPicker && (
              <PickerSelect
                items={lensItems}
                value={lensId}
                onChange={onLensChange}
                title="Lens"
                leftAdornment={<Eye size={12} className="text-fg-muted" />}
                minTriggerWidth={88}
                popoverMinWidth={200}
                sectionLabel="lens · how the substrate is shown"
              />
            )}
          </>
        )}
      </div>

      <Divider />

      {/* Transport. Buttons are gated by lens capabilities — play and
          single-step are hidden when the lens declares no AUTOPLAY: both
          advance *autonomous* ticks, which is meaningless for a turn-based
          lens (it advances on player moves, not on stepping). Step-back is
          deferred (no history primitive for "untick" yet). Rewind +
          fast-forward are pure history navigation (jump to a commit) and
          work against any lens. */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onRewindToStart}
          className="btn btn-ghost btn-icon"
          title="Rewind to start"
        >
          <Rewind size={13} />
        </button>
        {canAutoplay && (
          <button
            type="button"
            onClick={togglePlaying}
            className="btn btn-primary btn-icon"
            style={{ width: 30, height: 30, margin: "0 2px" }}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
        )}
        {canAutoplay && (
          <button
            type="button"
            onClick={onStepForward}
            className="btn btn-ghost btn-icon"
            title="Step forward one tick"
          >
            <SkipForward size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onFastForwardToHead}
          className="btn btn-ghost btn-icon"
          title="Fast forward to HEAD"
        >
          <FastForward size={13} />
        </button>
        {canWithdraw && (
          <>
            <div className="mx-1 h-4 w-px" style={{ background: "var(--border)" }} />
            <button
              type="button"
              onClick={onWithdraw}
              className="btn btn-ghost btn-icon"
              title="Withdraw — drop your placed biases and watch if the structure holds"
            >
              <Eraser size={13} />
            </button>
          </>
        )}
        {canAutoplay && (
          <>
            <div className="mx-1 h-4 w-px" style={{ background: "var(--border)" }} />
            <div className="flex items-center">
              <SpeedSelect
                speeds={activeLens.speeds}
                value={speedId}
                onChange={onSpeedChange}
              />
            </div>
          </>
        )}
      </div>

      <Divider />

      {/* Readouts — universal (tick/fps/seed). */}
      <div className="flex items-center gap-3 px-2 font-mono text-[length:var(--text-sm)] text-fg-muted">
        <Readout label="tick" value={String(playheadTick).padStart(4, "0")} />
        <Readout label="fps" value={String(Math.round(fps.instant))} />
        <Readout label="avg" value={String(Math.round(fps.averageTotal))} />
        <Readout label="10s" value={String(Math.round(fps.average10s))} />
        <Readout label="min" value={String(Math.round(fps.min10s))} />
        <Readout label="seed" value={formatSeed(session.history.rng_seed_initial)} />
      </div>

      {/* Lens-supplied HudMetrics — divided from the universal cluster
          so the substrate-specific readings read as a separate group.
          Lens computes per-tick; chrome re-renders on `playheadTick`
          and re-reads via `session.mounted_lens?.hudMetrics?.()`. */}
      {(() => {
        const metrics = session.mounted_lens?.hudMetrics?.() ?? [];
        if (metrics.length === 0) return null;
        return (
          <>
            <Divider />
            <div className="flex items-center gap-3 px-2 font-mono text-[length:var(--text-sm)] text-fg-muted">
              {metrics.map((m) =>
                m.icon ? (
                  <Readout key={m.id} icon={m.icon} label={m.label} value={m.value} />
                ) : (
                  <Readout key={m.id} label={m.label} value={m.value} />
                ),
              )}
            </div>
          </>
        );
      })()}

      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={captureSubstrateState}
          title="Copy substrate State as JSON — the data the lens renders from (falls back to download)"
          aria-label="Copy substrate state as JSON"
        >
          {stateCaptured ? <Check size={13} /> : <Braces size={13} />}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={triggerSnapshot}
          title="Snapshot — download the current frame as PNG"
        >
          <Camera size={13} />
        </button>
        {/* Dev-only: open the post-ready embed for the current substrate, for
            screenshots. Served verbatim by the serve-embeds vite middleware;
            build it first with `npm run export -- <id>`. */}
        {import.meta.env.DEV && (
          <a
            href={`/embed/${substrateId}`}
            target="_blank"
            rel="noopener"
            className="btn btn-ghost btn-icon"
            title="Open embed view (dev — for screenshots)"
            aria-label="Open embed view"
          >
            <ExternalLink size={13} />
          </a>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={toggleKitchenSink}
          title="Kitchen Sink · all primitives"
        >
          <Beaker size={13} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={toggleHelp}
          title="Help"
        >
          <CircleHelp size={13} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={toggleSettings}
          title="Settings"
        >
          <Settings size={13} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          title={theme === "light" ? "Switch to dark" : "Switch to light"}
        >
          {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
        </button>
        <Divider />
        {onClose && (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            title="Hide toolbar"
            aria-label="Hide toolbar"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="my-1.5 w-px self-stretch"
      style={{ background: "var(--border)" }}
    />
  );
}

// 32-bit unsigned hex with a midpoint dot, for legibility. `0xABCD·1234`
// reads more cleanly than `0xABCD1234` at toolbar typography sizes.
function formatSeed(seed: number): string {
  const u32 = (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `0x${u32.slice(0, 4)}·${u32.slice(4)}`;
}

function Readout({
  icon,
  label,
  value,
}: {
  icon?: string;
  label: string;
  value: string;
}) {
  const Icon = hudIcon(icon);
  return (
    <span className="inline-flex items-center gap-1">
      {Icon ? <Icon size={11} /> : null}
      <span className="text-fg-faint">{label} </span>
      <span className="text-fg">{value}</span>
    </span>
  );
}
