/* Spec §10 — schema-driven Rules rail.
   Schema: session.active_lens.tunables.
   Values: target='lens' → mounted.getTunable(path)
           target='config' → history.config[path]
   Reactivity:
     - target='lens' → subscribe to mounted.subscribeTunables(cb).
     - target='config' → re-render on historyVersion (chrome bumps it
       on write).
   No working-copy / dirty workflow yet — immediate-apply. The
   stage-and-commit ceremony per spec §10 lands when a substrate with
   target='config' tunables joins the new shell and the chrome wants
   to stage edits before flushing to history.config. */

import { Settings, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { session } from "@/app/session";
import { useStore } from "@/app/store";
import type { LensTunable, TunableValue } from "@/lenses/types";

export function RulesRail({ onClose }: { onClose?: () => void }) {
  // Re-render when the lens (re)mounts. session.mounted_lens isn't in
  // React state, so we piggyback on historyVersion which gets bumped by
  // SubstrateHost after mount.
  const historyVersion = useStore((s) => s.historyVersion);
  // Re-render when the lens notifies of a tunable change (driven by its
  // own setTunable internally, or by any other code calling setTunable).
  const [, bumpUI] = useState(0);
  const openRulesGroups = useStore((s) => s.openRulesGroups);
  const toggleRulesGroup = useStore((s) => s.toggleRulesGroup);

  useEffect(() => {
    const lens = session.mounted_lens;
    if (!lens) return;
    return lens.subscribeTunables(() => bumpUI((b) => b + 1));
  }, [historyVersion]);

  const lens = session.active_lens;

  // Group tunables by `group`, preserving first-seen order.
  const groups: { name: string; items: LensTunable[] }[] = [];
  const groupIdx = new Map<string, number>();
  for (const t of lens.tunables) {
    let idx = groupIdx.get(t.group);
    if (idx === undefined) {
      idx = groups.length;
      groupIdx.set(t.group, idx);
      groups.push({ name: t.group, items: [] });
    }
    groups[idx]!.items.push(t);
  }

  return (
    <div className="flex max-h-full flex-col gap-2 overflow-y-auto">
      {/* Master title bar — owns the "hide the whole rail" close X. The
          existing PanelStub re-opens it. Kept separate from the per-
          group toolboxes so toggling individual groups doesn't fight
          the master affordance. */}
      <MasterTitleBar
        title={`rules · ${lens.name.toLowerCase()}`}
        onClose={onClose}
      />

      {groups.length === 0 && (
        <GroupPanel title="lens" empty />
      )}

      {groups.map((g) => {
        const isOpen = !!openRulesGroups[g.name];
        const label = g.name.toLowerCase();
        const onToggle = () => toggleRulesGroup(g.name);
        if (isOpen) {
          return (
            <GroupPanel key={g.name} title={label} onClose={onToggle}>
              {g.items.map((t) => (
                <RuleControl
                  key={t.id}
                  rule={t}
                  value={readTunable(t)}
                  onChange={(v) => writeTunable(t, v)}
                />
              ))}
            </GroupPanel>
          );
        }
        return <ClosedGroupTab key={g.name} label={label} onOpen={onToggle} />;
      })}
    </div>
  );
}

function MasterTitleBar({
  title,
  onClose,
}: {
  title: string;
  onClose?: (() => void) | undefined;
}) {
  return (
    <div className="glass-med rounded-panel flex h-9 items-center justify-between px-3">
      <div className="flex items-center gap-2">
        <Settings size={12} className="text-fg-muted" />
        <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
          {title}
        </div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost btn-icon"
          style={{ width: 22, height: 22 }}
          aria-label="Hide rules"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function ClosedGroupTab({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}) {
  // Looks like a panel header with no body; clicking the row opens the
  // group. Visually echoes the open `GroupPanel` header so the rail
  // reads as a stack of collapsed/expanded sections.
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-med rounded-panel flex h-9 w-full items-center justify-between px-3 text-left transition-colors hover:text-fg"
      aria-label={`Open ${label} rules`}
    >
      <div className="flex items-center gap-2">
        <Settings size={12} className="text-fg-muted" />
        <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
          {label}
        </div>
      </div>
      <span className="font-mono text-[length:var(--text-xs)] text-fg-faint">+</span>
    </button>
  );
}

function GroupPanel({
  title,
  onClose,
  empty,
  children,
}: {
  title: string;
  onClose?: (() => void) | undefined;
  empty?: boolean | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="glass-med rounded-panel flex flex-col overflow-hidden">
      <div className="flex h-9 items-center justify-between border-b border-[var(--border)] px-3">
        <div className="flex items-center gap-2">
          <Settings size={12} className="text-fg-muted" />
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
            {title}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22 }}
            aria-label="Hide rules"
          >
            <X size={10} />
          </button>
        )}
      </div>
      <div className="p-2">
        {empty ? (
          <div className="px-2 py-3 text-[length:var(--text-sm)] text-fg-faint">
            no tunables exposed by this lens
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function readTunable(t: LensTunable): TunableValue | undefined {
  if (t.target === "lens") {
    return session.mounted_lens?.getTunable(t.path);
  }
  return getByPath(session.history.config, t.path);
}

function writeTunable(t: LensTunable, value: TunableValue): void {
  if (t.target === "lens") {
    // Lens auto-notifies its subscribers; our useEffect listener bumps
    // local UI state in response.
    session.mounted_lens?.setTunable(t.path, value);
    return;
  }
  // Config writes go directly to the (shared, polled) history.config.
  // Bump historyVersion so anything subscribed (including this rail
  // through its own historyVersion subscription) re-renders.
  setByPath(session.history.config, t.path, value);
  useStore.getState().bumpHistoryVersion();
}

function getByPath(obj: unknown, path: string[]): TunableValue | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur === "number" || typeof cur === "boolean" || typeof cur === "string") {
    return cur;
  }
  return undefined;
}

function setByPath(obj: unknown, path: string[], value: TunableValue): void {
  if (obj === null || typeof obj !== "object") return;
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = cur[key];
    if (next === null || typeof next !== "object") return;
    cur = next as Record<string, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}

function RuleControl({
  rule,
  value,
  onChange,
}: {
  rule: LensTunable;
  value: TunableValue | undefined;
  onChange: (v: TunableValue) => void;
}) {
  if (rule.type === "bool") {
    const v = !!value;
    return (
      <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-[var(--row-hover)]">
        <span className="text-[length:var(--text-sm)]">{rule.label}</span>
        <button
          type="button"
          onClick={() => onChange(!v)}
          className="rounded px-2 py-0.5 font-mono text-[length:var(--text-xs)]"
          style={{
            background: v ? "var(--accent)" : "var(--btn-bg)",
            color: v ? "var(--accent-text)" : "var(--fg-muted)",
            fontWeight: v ? 700 : 500,
            border: "1px solid " + (v ? "var(--accent)" : "var(--border)"),
          }}
        >
          {v ? "on" : "off"}
        </button>
      </div>
    );
  }

  if (rule.type === "enum" && rule.display === "list") {
    const v = String(value ?? "");
    return (
      <div className="px-2 py-1.5">
        <span className="text-[length:var(--text-xs)]" style={{ color: "var(--fg-muted)" }}>
          {rule.label}
        </span>
        <ul className="mt-1 flex flex-col gap-0.5">
          {rule.options.map((o) => {
            const sel = v === o;
            return (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => onChange(o)}
                  className="w-full rounded px-2 py-1 text-left font-mono text-[length:var(--text-xs)]"
                  style={{
                    background: sel ? "var(--accent)" : "var(--btn-bg)",
                    color: sel ? "var(--accent-text)" : "var(--fg-muted)",
                    fontWeight: sel ? 700 : 500,
                    border: "1px solid " + (sel ? "var(--accent)" : "var(--border)"),
                  }}
                >
                  {o}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (rule.type === "enum") {
    const v = String(value ?? "");
    return (
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[length:var(--text-sm)]">{rule.label}</span>
        <div className="flex">
          {rule.options.map((o, i) => {
            const sel = v === o;
            const isFirst = i === 0;
            const isLast = i === rule.options.length - 1;
            return (
              <button
                key={o}
                type="button"
                onClick={() => onChange(o)}
                className="px-2 py-0.5 font-mono text-[length:var(--text-xs)]"
                style={{
                  background: sel ? "var(--accent)" : "var(--btn-bg)",
                  color: sel ? "var(--accent-text)" : "var(--fg-muted)",
                  fontWeight: sel ? 700 : 500,
                  borderStyle: "solid",
                  borderColor: sel ? "var(--accent)" : "var(--border)",
                  borderTopWidth: 1,
                  borderRightWidth: 1,
                  borderBottomWidth: 1,
                  borderLeftWidth: isFirst ? 1 : 0,
                  borderRadius: isFirst
                    ? "4px 0 0 4px"
                    : isLast
                      ? "0 4px 4px 0"
                      : 0,
                }}
              >
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // float / int → slider
  const n = typeof value === "number" ? value : Number(value ?? rule.min);

  // Non-linear mapping: slider position runs in [-1, +1] at fine step,
  // value maps via sign(t) * M * |t|^3 (cube of slider position scaled
  // to the rule's range). Reads as "fine near zero, coarse at extremes."
  // Only applies to symmetric `signed-cubic` float rules; other rules
  // (int, bool, enum, linear floats) stay on the native range mapping.
  const is_signed_cubic =
    rule.type === "float" && rule.curve === "signed-cubic";
  const M = is_signed_cubic
    ? Math.max(Math.abs(rule.min), Math.abs(rule.max))
    : 0;
  const slider_t = is_signed_cubic
    ? Math.sign(n) * Math.cbrt(Math.abs(n) / Math.max(M, 1e-9))
    : n;
  const slider_min = is_signed_cubic ? -1 : rule.min;
  const slider_max = is_signed_cubic ? 1 : rule.max;
  const slider_step = is_signed_cubic ? 0.001 : rule.step;
  const pct =
    ((slider_t - slider_min) / (slider_max - slider_min)) * 100;

  return (
    <div className="px-2 py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[length:var(--text-sm)]">{rule.label}</span>
        <span className="font-mono text-[length:var(--text-xs)] text-fg">
          {rule.type === "int"
            ? n
            : (Math.round(n * 1000) / 1000).toFixed(3)}
          {rule.unit && (
            <span className="text-fg-faint"> {rule.unit}</span>
          )}
        </span>
      </div>
      <input
        type="range"
        className="rng mt-1"
        min={slider_min}
        max={slider_max}
        step={slider_step}
        value={slider_t}
        style={{ ["--val" as string]: `${pct}%` }}
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          if (is_signed_cubic) {
            const phys = Math.sign(raw) * M * Math.abs(raw) ** 3;
            onChange(phys);
          } else {
            onChange(
              rule.type === "int" ? parseInt(e.target.value, 10) : raw,
            );
          }
        }}
      />
    </div>
  );
}
