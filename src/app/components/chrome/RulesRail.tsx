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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { historyEditConfig } from "@/history";
import { session } from "@/app/session";
import { SUBSTRATE_BY_ID } from "@/app/substrates";
import { checkConfigWrites, type ConfigWrite } from "@/lenses/config-write";
import { useStore } from "@/app/store";
import type { LensTunable, TunableValue } from "@/lenses/types";
import { buildDump, planApply } from "./config-io";
import { enumDisplay } from "./enum-display";

export function RulesRail({ onClose }: { onClose?: () => void }) {
  // Re-render when the lens (re)mounts. session.mounted_lens isn't in
  // React state, so we piggyback on historyVersion which gets bumped by
  // SubstrateHost after mount.
  const historyVersion = useStore((s) => s.historyVersion);
  // Re-render when the lens notifies of a tunable change (driven by its
  // own setTunable internally, or by any other code calling setTunable).
  const [, bumpUI] = useState(0);
  const openRulesGroups = useStore((s) => s.openRulesGroups);
  // A refused knob write (S263): shown here, not thrown out of the event handler where nobody reads it
  const [refusal, setRefusal] = useState<string | null>(null);
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

  /* ⚠ ONE LIST, COUNTED ONCE. The menu and the "all hidden" notice are two readouts of
   * the same quantity, and the first draft derived them from two different sets — the
   * menu included the config pseudo-group and the notice did not, so a fresh rail
   * announced "groups 0/3" beside "2 groups hidden". Two numbers naming one population,
   * on screen, at the same time. */
  const allGroups = [CONFIG_GROUP, ...groups.map((g) => g.name)];
  const hiddenCount = allGroups.filter((n) => !openRulesGroups[n]).length;

  return (
  /* ⚠ HEADER OUTSIDE THE SCROLL BOX, BODY INSIDE, AND THE SPLIT IS A BUG FIX FOR THE
   * CHANGE THAT INTRODUCED IT. With the whole rail as one `overflow-y-auto` column, the
   * title bar's groups dropdown was a child of that column — and an absolutely
   * positioned element inside a scroll container is CLIPPED BY IT. The menu rendered
   * and was then cut off at the container edge, which is worse than not rendering: it
   * read as broken rather than absent. The scroll fix and the thing it broke shipped in
   * the same change, which is the shape the corpus keeps naming — a repair is the
   * highest-risk place to create the next defect.
   *
   * ⚠ This wrapper must NOT carry `overflow`, or the clip returns. */
    <div className="flex h-full max-h-full flex-col gap-2">
      {/* Master title bar — owns the "hide the whole rail" close X. The
          existing PanelStub re-opens it. Kept separate from the per-
          group toolboxes so toggling individual groups doesn't fight
          the master affordance. */}
      <MasterTitleBar
        title={`rules · ${lens.name.toLowerCase()}`}
        groups={allGroups}
        isOpen={(name) => !!openRulesGroups[name]}
        onToggleGroup={toggleRulesGroup}
        onClose={onClose}
      />
      {refusal !== null && (
        <div
          className="glass-med rounded-panel shrink-0 px-3 py-2 font-mono text-[length:var(--text-xs)]"
          style={{ color: "var(--accent)" }}
          data-rules-refusal
        >
          {refusal}
        </div>
      )}
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">

      {groups.length === 0 && (
        <GroupPanel title="lens" empty />
      )}

      {openRulesGroups[CONFIG_GROUP] && (
        <GroupPanel
          title="config"
          onClose={() => toggleRulesGroup(CONFIG_GROUP)}
        >
          <ConfigPanel tunables={lens.tunables} />
        </GroupPanel>
      )}

      {/* ⚠ ONLY OPEN GROUPS RENDER. A closed group used to keep a full-height
          header row in the rail, so eight groups cost eight rows before any
          control — the rail was mostly a list of things you were not looking at.
          Visibility moved to the menu in the title bar above. */}
      {groups.filter((g) => openRulesGroups[g.name]).map((g) => (
        <GroupPanel
          key={g.name}
          title={g.name.toLowerCase()}
          onClose={() => toggleRulesGroup(g.name)}
        >
          {g.items.map((t) => (
            <RuleControl
              key={t.id}
              rule={t}
              value={readTunable(t)}
              onChange={(v) => {
                try {
                  writeTunable(t, v);
                  setRefusal(null);
                } catch (e) {
                  setRefusal(`${t.id} refused — ${(e as Error).message}`);
                  bumpUI((b) => b + 1); // the control re-reads the value that stands
                }
              }}
            />
          ))}
        </GroupPanel>
      ))}

      {/* ⚠ NEVER-FAIL-SILENTLY AT THE UI TIER. With closed groups rendering
          nothing, an all-closed rail is an empty box that looks broken rather
          than empty. Say which state it is and where the switch is. */}
      {hiddenCount === allGroups.length && allGroups.length > 0 && (
        <div
          className="glass-med rounded-panel shrink-0 px-3 py-2 font-mono text-[length:var(--text-xs)]"
          style={{ color: "var(--fg-faint)" }}
        >
          {hiddenCount} group{hiddenCount === 1 ? "" : "s"} hidden — open them from
          the <span style={{ color: "var(--fg-muted)" }}>groups</span> menu above.
        </div>
      )}
      </div>
    </div>
  );
}

/** The rail's title bar, and the owner of group visibility.
 *
 * ⚠ THE MENU LIVES HERE RATHER THAN IN THE TOOLBAR, deliberately. It governs the
 * rules groups and nothing else, so putting it in the global toolbar would imply a
 * scope it does not have — and the toolbar is shared by every substrate while the
 * group list is per-lens and changes on a lens swap.
 */
function MasterTitleBar({
  title,
  groups,
  isOpen,
  onToggleGroup,
  onClose,
}: {
  title: string;
  groups: string[];
  isOpen: (name: string) => boolean;
  onToggleGroup: (name: string) => void;
  onClose?: (() => void) | undefined;
}) {
  const [menu, setMenu] = useState(false);
  const openCount = groups.filter(isOpen).length;
  const box = useRef<HTMLDivElement | null>(null);

  /* ⚠ CLICK-OUTSIDE AND ESC, because the first version could only be closed by hitting
   * the same button again. A dropdown you cannot dismiss the way every other dropdown
   * dismisses is not a small annoyance — it is the control reading as stuck. */
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") setMenu(false); };
    // `true` — capture, so a click on the canvas beneath still closes it
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  return (
    /* ⚠ `z-30` ON THE HEADER ITSELF, not only on the dropdown. `glass-med` applies a
       `backdrop-filter`, and that CREATES A STACKING CONTEXT — so the menu's own z-index
       is scoped inside this element and cannot lift it above a SIBLING. With the header
       unlayered, the scrolling body painted over the menu's first two rows and they
       vanished behind the "groups hidden" notice: the menu looked truncated while being
       perfectly complete. A z-index on a child cannot escape its parent's context. */
    <div ref={box} className="glass-med rounded-panel relative z-30 flex h-9 shrink-0 items-center justify-between px-3">
      <div className="flex items-center gap-2">
        <Settings size={12} className="text-fg-muted" />
        <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
          {title}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {groups.length > 0 && (
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            className="btn btn-ghost font-mono text-[length:var(--text-xs)] lowercase"
            style={{ height: 22, padding: "0 6px" }}
            aria-expanded={menu}
            aria-label="Choose which rule groups are shown"
          >
            groups {openCount}/{groups.length}
          </button>
        )}
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

      {menu && (
        <div
          className="rounded-panel absolute right-0 top-10 z-30 flex max-h-[60vh] min-w-[11rem] flex-col overflow-y-auto p-1 shadow-lg"
          /* ⚠ AN OPAQUE BACKGROUND, NOT `glass-med`. The panels are translucent because
             they sit over a mostly-static canvas; a MENU sits over whatever the
             substrate is drawing right now, and a nine-row list over a dancing tissue
             is unreadable. Same reason it needs a z-index above the panels rather than
             beside them. */
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          role="menu"
        >
          {groups.map((name) => {
            const on = isOpen(name);
            return (
              <button
                key={name}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onToggleGroup(name)}
                className="flex shrink-0 items-center gap-2 rounded px-2 py-1 text-left font-mono text-[length:var(--text-xs)] lowercase hover:text-fg"
                style={{ color: on ? "var(--fg)" : "var(--fg-faint)" }}
              >
                <span style={{ width: "1ch" }}>{on ? "\u2713" : ""}</span>
                {name.toLowerCase()}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ⚠ A PSEUDO-GROUP, NOT A TUNABLE GROUP. `CONFIG_GROUP` is not a `group` any substrate
 * declares — it is a name reserved by the chrome so the config panel can share the
 * open/close machinery, the menu and the scroll behaviour that real groups have. It is
 * spelled with a space because a `group` string is a plain identifier in substrate code
 * and nobody would type one with a space; a collision would silently merge the two.
 * The same class of mistake as naming a display tier `Colour` next to a physics one. */
const CONFIG_GROUP = "· config";

/** The whole-world dump/load, driven only by the tunable manifest — so every substrate
 *  gets it without writing a line. Writes go through `writeTunable`, the same function
 *  a slider calls. */
function ConfigPanel({ tunables }: { tunables: readonly LensTunable[] }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "bad"; lines: string[] } | null>(null);

  const meta = {
    substrate: session.active_substrate_id,
    lens: session.active_lens_id,
    puzzle: session.active_puzzle_id,
  };

  const dump = () => {
    setText(JSON.stringify(buildDump(meta, tunables, readTunable), null, 2));
    setStatus({ kind: "ok", lines: [`dumped ${tunables.length} knobs`] });
  };

  const load = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setStatus({ kind: "bad", lines: [`not JSON: ${(e as Error).message}`] });
      return;
    }
    const plan = planApply(parsed, meta, tunables);
    if (plan.mismatch !== null) {
      setStatus({ kind: "bad", lines: [`refused — ${plan.mismatch}`] });
      return;
    }
    const byId = new Map(tunables.map((t) => [t.id, t]));
    // ★ THE CONFIG HALF IS JUDGED AS ONE BATCH, BEFORE ANY WRITE (S263): where the pasted world LANDS, not each knob
    // in paste order — two knobs legal together can be illegal one at a time — and a refusal applies nothing.
    const configWrites: ConfigWrite[] = plan.writes.flatMap((w) => {
      const t = byId.get(w.id);
      return t && t.target === "config" ? [{ tunable: t, value: w.value }] : [];
    });
    try {
      checkConfigWrites(session.history.config, configWrites, activeCheck());
    } catch (e) {
      setStatus({ kind: "bad", lines: [`refused — ${(e as Error).message}`, "nothing was applied"] });
      return;
    }
    const problems = [...plan.problems];
    let applied = 0;
    for (const w of plan.writes) {
      const t = byId.get(w.id);
      if (!t) continue;
      try {
        applyTunable(t, w.value);
        applied++;
      } catch (e) {
        problems.push(`"${w.id}" refused — ${(e as Error).message}`); // a lens-target refusal, from the lens itself
      }
    }
    setStatus({
      kind: problems.length > 0 ? "bad" : "ok",
      lines: [`applied ${applied} of ${plan.writes.length} knobs`, ...problems],
    });
  };

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2">
      <div className="flex gap-1">
        <button type="button" onClick={dump} className="btn btn-ghost font-mono text-[length:var(--text-xs)]" style={{ height: 22, padding: "0 8px" }}>
          dump
        </button>
        <button type="button" onClick={load} className="btn btn-ghost font-mono text-[length:var(--text-xs)]" style={{ height: 22, padding: "0 8px" }} disabled={text.trim() === ""}>
          load
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={8}
        placeholder="press dump, or paste a config here and press load"
        className="w-full rounded p-1.5 font-mono text-[length:var(--text-xs)]"
        style={{ background: "var(--btn-bg)", color: "var(--fg-muted)", border: "1px solid var(--border)", resize: "vertical" }}
      />
      {status && (
        <div
          className="font-mono text-[length:var(--text-xs)]"
          style={{ color: status.kind === "ok" ? "var(--fg-muted)" : "var(--accent)" }}
        >
          {status.lines.map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
      {/* ⚠ THE CAVEAT SHIPS WITH THE FEATURE. A dump rebuilds the world you are in; it
          does not replay the path you took to get there. Without this line the panel
          quietly promises reproducibility it cannot give. */}
      <div className="font-mono text-[length:var(--text-xs)]" style={{ color: "var(--fg-faint)" }}>
        a dump is a world, not a trajectory — it will not replay a live-tweaked run
      </div>
    </div>
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
    /* ⚠ `shrink-0`: a direct child of the scrolling flex column. Without it the
       browser SQUASHES the panels to fit instead of scrolling them, which is a
       quieter failure than the overflow it replaced — measured in isolation as
       client=393 / scroll=393 / scrolls=false, i.e. no scrollbar and no clue.
       Bounding the container was only half the fix. */
    <div className="glass-med rounded-panel flex shrink-0 flex-col overflow-hidden">
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

/** the active substrate's whole-config invariants, if it declares any (S263) */
function activeCheck() {
  return SUBSTRATE_BY_ID[session.active_substrate_id]?.checkConfig;
}

/** A knob write from the rail: a config one is CHECKED first (declaration + the substrate's checkConfig, the same
 *  check the embed mount and a lens's own setter take, `lenses/config-write.ts`); throws, naming the refusal. */
function writeTunable(t: LensTunable, value: TunableValue): void {
  if (t.target === "config") checkConfigWrites(session.history.config, [{ tunable: t, value }], activeCheck());
  applyTunable(t, value);
}

/** The write itself, unchecked — only for a value `checkConfigWrites` has already passed. */
function applyTunable(t: LensTunable, value: TunableValue): void {
  if (t.target === "lens") {
    // Lens auto-notifies its subscribers; our useEffect listener bumps
    // local UI state in response.
    session.mounted_lens?.setTunable(t.path, value);
    return;
  }
  // Config writes go through the history's edit API (spec/31), so replay
  // reproduces them; it refuses a path through a missing parent, which
  // setByPath skipped silently. Bump historyVersion so anything subscribed
  // (including this rail through its own historyVersion subscription)
  // re-renders.
  historyEditConfig(session.history, t.path, value);
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

  if (rule.type === "enum" && enumDisplay(rule) === "list") {
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
