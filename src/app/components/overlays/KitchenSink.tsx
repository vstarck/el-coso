/* Spec §17.1 — Kitchen Sink. Dev-only reference panel labelling every
   UI primitive with its shadcn/ui equivalent. Gated behind
   import.meta.env.DEV in production. */

import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Beaker,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Command,
  GitBranch,
  GitCommit,
  GitCompare,
  Layers,
  Moon,
  Pause,
  Pin,
  Play,
  Rewind,
  Settings,
  SkipBack,
  SkipForward,
  Sun,
  X,
} from "lucide-react";
import { useStore } from "@/app/store";
import { useDraggablePanel } from "./useDraggablePanel";

const ICON_GRID = [
  { name: "play", I: Play },
  { name: "pause", I: Pause },
  { name: "skip-back", I: SkipBack },
  { name: "skip-forward", I: SkipForward },
  { name: "rewind", I: Rewind },
  { name: "git-branch", I: GitBranch },
  { name: "git-commit", I: GitCommit },
  { name: "git-compare", I: GitCompare },
  { name: "arrow-right", I: ArrowRight },
  { name: "pin", I: Pin },
  { name: "x", I: X },
  { name: "settings", I: Settings },
  { name: "command", I: Command },
  { name: "circle-help", I: CircleHelp },
  { name: "beaker", I: Beaker },
  { name: "layers", I: Layers },
  { name: "sun", I: Sun },
  { name: "moon", I: Moon },
];

export function KitchenSink() {
  const open = useStore((s) => s.kitchenSinkOpen);
  const toggleKitchenSink = useStore((s) => s.toggleKitchenSink);
  const { panelRef, startDrag, pos } = useDraggablePanel();

  const [text, setText] = useState("open-field-disperse-spawn");
  const [num, setNum] = useState(0.062);
  const [sel, setSel] = useState("conway");
  const [seg, setSeg] = useState("xy");
  const [multi, setMulti] = useState<string[]>(["main", "open·field"]);
  const [slider, setSlider] = useState(11);
  const [sw, setSw] = useState(true);
  const [chk, setChk] = useState(true);
  const [chk2, setChk2] = useState(false);
  const [radio, setRadio] = useState("on commit");
  const [tab, setTab] = useState("inspector");
  const [color, setColor] = useState("#fbbf24");

  if (!open) return null;
  if (!import.meta.env.DEV) return null;

  const positionStyle: React.CSSProperties =
    pos.x === null || pos.y === null
      ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
      : { left: pos.x, top: pos.y };

  return (
    <div
      ref={panelRef}
      className="glass-heavy pointer-events-auto"
      style={{
        position: "fixed",
        zIndex: 50,
        width: 640,
        maxHeight: "88vh",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        ...positionStyle,
      }}
    >
      {/* Header (drag handle) */}
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
          <Layers size={13} className="text-fg-muted" />
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
            kitchen sink
          </div>
          <span className="chip font-mono">all primitives</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[length:var(--text-xs)] text-fg-faint">
            react · tailwind · shadcn/ui
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22, marginLeft: 6 }}
            onClick={toggleKitchenSink}
            aria-label="Close kitchen sink"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ overflow: "auto", padding: 14 }}>
        <Section title="buttons" shadcn="<Button>">
          <Row label="variants">
            <button type="button" className="btn btn-primary">
              <ArrowRight size={11} /> primary
            </button>
            <button type="button" className="btn">
              default
            </button>
            <button type="button" className="btn btn-ghost">
              ghost
            </button>
            <button
              type="button"
              className="btn"
              style={{
                background: "rgba(248,113,113,0.10)",
                borderColor: "rgba(248,113,113,0.35)",
                color: "#f87171",
              }}
            >
              destructive
            </button>
            <button
              type="button"
              className="btn"
              disabled
              style={{ opacity: 0.4, cursor: "not-allowed" }}
            >
              disabled
            </button>
          </Row>
          <Row label="sizes">
            <button
              type="button"
              className="btn"
              style={{ height: 22, padding: "0 7px", fontSize: "var(--text-xs)" }}
            >
              sm
            </button>
            <button type="button" className="btn">
              md
            </button>
            <button
              type="button"
              className="btn"
              style={{ height: 32, padding: "0 14px", fontSize: "var(--text-base)" }}
            >
              lg
            </button>
            <button type="button" className="btn btn-icon">
              <Settings size={13} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              style={{ width: 30, height: 30 }}
            >
              <Play size={14} />
            </button>
          </Row>
          <Row label="with kbd">
            <button type="button" className="btn btn-ghost">
              <Command size={11} /> palette <kbd>⌘</kbd>
              <kbd>K</kbd>
            </button>
          </Row>
        </Section>

        <Section title="text input" shadcn="<Input>  <Textarea>">
          <Row label="default">
            <TextInput value={text} onChange={setText} placeholder="run name…" />
          </Row>
          <Row label="mono">
            <TextInput value="fe091a2" onChange={() => {}} mono />
          </Row>
          <Row label="disabled">
            <TextInput value="locked" onChange={() => {}} disabled />
          </Row>
          <Row label="invalid">
            <TextInput value="bad value" onChange={() => {}} invalid />
          </Row>
          <Row label="textarea" alignTop>
            <textarea
              placeholder="commit message…"
              style={{
                flex: 1,
                minHeight: 56,
                padding: 8,
                fontSize: "var(--text-sm)",
                background: "var(--field-bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--fg)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </Row>
          <Row label="number">
            <NumberInput
              value={num}
              onChange={setNum}
              min={0}
              max={1}
              step={0.01}
              unit="σ"
            />
          </Row>
        </Section>

        <Section title="select · single" shadcn="<Select>  <Combobox>">
          <Row label="native">
            <NativeSelect
              value={sel}
              onChange={setSel}
              options={["conway", "reaction·diff", "flocks", "lattice·gas"]}
            />
          </Row>
          <Row label="segmented">
            <Segmented
              value={seg}
              onChange={setSeg}
              options={["off", "x", "y", "xy"]}
            />
          </Row>
          <Row label="radio">
            <Radio
              value={radio}
              onChange={setRadio}
              options={["on commit", "every tick", "manual"]}
            />
          </Row>
        </Section>

        <Section
          title="select · multiple"
          shadcn="<ToggleGroup>  <Combobox multi>"
        >
          <Row label="chips" alignTop>
            <MultiSelect
              value={multi}
              onChange={setMulti}
              options={[
                "main",
                "diffuse·low",
                "spawn·burst",
                "decay·fast",
                "spawn·tuned",
                "open·field",
              ]}
            />
          </Row>
        </Section>

        <Section title="slider" shadcn="<Slider>">
          <Row label="single">
            <SliderDemo
              value={slider}
              onChange={setSlider}
              min={1}
              max={32}
              step={1}
              unit="px"
            />
          </Row>
          <Row label="float">
            <SliderDemo value={num} onChange={setNum} min={0} max={1} step={0.01} />
          </Row>
        </Section>

        <Section title="toggles" shadcn="<Switch>  <Checkbox>">
          <Row label="switch">
            <Switch value={sw} onChange={setSw} />
            <span className="text-[length:var(--text-sm)] text-fg-muted">
              {sw ? "on" : "off"}
            </span>
            <span style={{ width: 16 }} />
            <Switch value={false} onChange={() => {}} disabled />
            <span className="text-[length:var(--text-sm)] text-fg-faint">disabled</span>
          </Row>
          <Row label="checkbox">
            <Checkbox value={chk} onChange={setChk} label="wall absorb" />
            <span style={{ width: 16 }} />
            <Checkbox value={chk2} onChange={setChk2} label="wrap edges" />
          </Row>
        </Section>

        <Section title="chips · badges" shadcn="<Badge>">
          <Row label="default">
            <span className="chip">commit</span>
            <span className="chip font-mono">t·2986</span>
            <span className="chip">
              <span
                className="chip-dot"
                style={{ background: "var(--lane-active)" }}
              />
              open·field
            </span>
          </Row>
          <Row label="status">
            <span
              className="chip font-mono"
              style={{
                color: "var(--accent)",
                borderColor: "var(--accent-edge)",
                background: "var(--accent-tint)",
              }}
            >
              ● uncommitted
            </span>
            <span
              className="chip font-mono"
              style={{
                color: "#f87171",
                borderColor: "rgba(248,113,113,0.35)",
                background: "rgba(248,113,113,0.10)",
              }}
            >
              ● error
            </span>
            <span
              className="chip font-mono"
              style={{
                color: "#34d399",
                borderColor: "rgba(52,211,153,0.35)",
                background: "rgba(52,211,153,0.10)",
              }}
            >
              ● synced
            </span>
            <span className="chip font-mono text-fg-faint">● abandoned</span>
          </Row>
        </Section>

        <Section
          title="color picker · curated"
          shadcn="<RadioGroup> w/ swatches"
        >
          <Row label="swatches">
            <ColorSwatches
              value={color}
              onChange={setColor}
              options={[
                "#fbbf24",
                "#7dd3fc",
                "#a3e635",
                "#f472b6",
                "#fb923c",
                "#fafafa",
              ]}
            />
          </Row>
        </Section>

        <Section title="tabs" shadcn="<Tabs>">
          <Tabs
            value={tab}
            onChange={setTab}
            options={["inspector", "rules", "history", "pinned"]}
          />
          <div className="mt-3 text-[length:var(--text-sm)] text-fg-muted">
            active tab → <span className="font-mono text-fg">{tab}</span>
          </div>
        </Section>

        <Section title="tooltip · kbd" shadcn="<Tooltip>  <Kbd>">
          <Row label="tooltip">
            <Tooltip content="checkout this commit">
              <button type="button" className="btn btn-ghost btn-icon">
                <ArrowRight size={12} />
              </button>
            </Tooltip>
            <Tooltip content="branch from selected">
              <button type="button" className="btn btn-ghost btn-icon">
                <GitBranch size={12} />
              </button>
            </Tooltip>
            <Tooltip content="compare with HEAD">
              <button type="button" className="btn btn-ghost btn-icon">
                <GitCompare size={12} />
              </button>
            </Tooltip>
          </Row>
          <Row label="kbd">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
            <span className="text-[length:var(--text-xs)] text-fg-dim">palette</span>
            <span style={{ width: 14 }} />
            <kbd>space</kbd>
            <span className="text-[length:var(--text-xs)] text-fg-dim">play</span>
            <span style={{ width: 14 }} />
            <kbd>⇧</kbd>
            <span className="text-fg-dim">+</span>
            <kbd>↵</kbd>
            <span className="text-[length:var(--text-xs)] text-fg-dim">force commit</span>
          </Row>
        </Section>

        <Section title="surfaces · glass tiers" shadcn="custom">
          <Row label="light" alignTop>
            <div
              className="glass-light"
              style={{ flex: 1, padding: 12, borderRadius: 8 }}
            >
              <div className="text-[length:var(--text-sm)]">toolbar tier · semi-transparent</div>
              <div className="mt-0.5 font-mono text-[length:var(--text-xs)] text-fg-dim">
                background: var(--panel-1)
              </div>
            </div>
          </Row>
          <Row label="medium" alignTop>
            <div
              className="glass-med"
              style={{ flex: 1, padding: 12, borderRadius: 8 }}
            >
              <div className="text-[length:var(--text-sm)]">rail / timeline tier · solid-ish</div>
              <div className="mt-0.5 font-mono text-[length:var(--text-xs)] text-fg-dim">
                background: var(--panel-2)
              </div>
            </div>
          </Row>
          <Row label="heavy" alignTop>
            <div
              className="glass-heavy"
              style={{ flex: 1, padding: 12, borderRadius: 8 }}
            >
              <div className="text-[length:var(--text-sm)]">floating tier · fully solid</div>
              <div className="mt-0.5 font-mono text-[length:var(--text-xs)] text-fg-dim">
                background: var(--panel-3)
              </div>
            </div>
          </Row>
        </Section>

        <Section
          title="lane palette · per branch status"
          shadcn="custom · laneColorForStatus()"
        >
          <Row label="tones">
            {([
              ["active", "var(--lane-active)"],
              ["alive", "var(--lane-alive)"],
              ["stale", "var(--lane-stale)"],
              ["abandoned", "var(--lane-abandoned)"],
            ] as const).map(([label, c]) => (
              <span
                key={label}
                className="flex items-center gap-1.5 font-mono text-[length:var(--text-xs)] text-fg-muted"
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: c,
                    border: "1px solid var(--border-2)",
                  }}
                />
                {label}
              </span>
            ))}
          </Row>
        </Section>

        <Section title="icons · the set we use" shadcn="lucide-react">
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
              gap: 6,
            }}
          >
            {ICON_GRID.map(({ name, I }) => (
              <div
                key={name}
                className="flex items-center gap-2 rounded px-2 py-1.5"
                style={{ background: "var(--btn-bg)" }}
              >
                <I size={13} />
                <span className="font-mono text-[length:var(--text-xs)] text-fg-muted">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span className="font-mono text-[length:var(--text-xs)] text-fg-faint">
          tokens · var(--bg) var(--fg) var(--accent) var(--border) …
        </span>
        <span className="font-mono text-[length:var(--text-xs)] text-fg-faint">
          drag header to move
        </span>
      </div>
    </div>
  );
}

/* ─── Layout helpers ───────────────────────────────────────────────── */

function Section({
  title,
  shadcn,
  children,
}: {
  title: string;
  shadcn?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <div className="text-[length:var(--text-sm)] font-medium uppercase tracking-[0.14em] text-fg-muted">
          {title}
        </div>
        {shadcn && (
          <div className="font-mono text-[length:var(--text-xs)] text-fg-faint">
            shadcn · <span className="text-fg-dim">{shadcn}</span>
          </div>
        )}
      </div>
      <div
        className="rounded-lg p-3"
        style={{
          background: "var(--field-bg)",
          border: "1px solid var(--border)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
  alignTop,
}: {
  label: string;
  children: ReactNode;
  alignTop?: boolean;
}) {
  return (
    <div
      className="flex"
      style={{
        alignItems: alignTop ? "flex-start" : "center",
        gap: 12,
        marginBottom: 10,
      }}
    >
      <div
        className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-dim"
        style={{ width: 78, paddingTop: alignTop ? 4 : 0, flexShrink: 0 }}
      >
        {label}
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/* ─── Inline primitives (dev-only, demo) ───────────────────────────── */

function Switch({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        width: 30,
        height: 18,
        padding: 2,
        borderRadius: 9,
        background: value ? "var(--accent)" : "var(--btn-bg)",
        border:
          "1px solid " + (value ? "var(--accent-edge)" : "var(--border-2)"),
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background .14s",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          display: "block",
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: value ? "var(--accent-text)" : "var(--fg-muted)",
          transform: value ? "translateX(12px)" : "translateX(0)",
          transition: "transform .14s",
        }}
      />
    </button>
  );
}

function Checkbox({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: value ? "var(--accent)" : "transparent",
          border:
            "1px solid " + (value ? "var(--accent-edge)" : "var(--border-2)"),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {value && (
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            stroke="var(--accent-text)"
            strokeWidth="3.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12 L10 17 L19 7" />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ display: "none" }}
      />
      <span className="text-[length:var(--text-base)]">{label}</span>
    </label>
  );
}

function Radio({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2">
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              border:
                "1px solid " +
                (value === o ? "var(--accent-edge)" : "var(--border-2)"),
              background: "transparent",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {value === o && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent)",
                }}
              />
            )}
          </span>
          <input
            type="radio"
            name="radio-demo"
            checked={value === o}
            onChange={() => onChange(o)}
            style={{ display: "none" }}
          />
          <span className="text-[length:var(--text-base)]">{o}</span>
        </label>
      ))}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={mono ? "font-mono" : ""}
      style={{
        height: 26,
        padding: "0 9px",
        fontSize: "var(--text-sm)",
        background: "var(--field-bg)",
        border:
          "1px solid " +
          (invalid ? "rgba(248,113,113,0.5)" : "var(--border)"),
        borderRadius: 6,
        color: "var(--fg)",
        outline: "none",
        flex: 1,
        minWidth: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 26,
        padding: "0 2px 0 9px",
        background: "var(--field-bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        gap: 6,
      }}
    >
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="input-bare font-mono"
        style={{ fontSize: "var(--text-sm)", width: 56, textAlign: "right" }}
      />
      {unit && (
        <span className="font-mono text-[length:var(--text-xs)] text-fg-faint">{unit}</span>
      )}
      <div className="flex flex-col" style={{ height: 22 }}>
        <button
          type="button"
          onClick={() => onChange((value || 0) + step)}
          className="btn btn-ghost btn-icon"
          style={{ width: 16, height: 11, borderRadius: 3 }}
        >
          <ChevronUp size={9} />
        </button>
        <button
          type="button"
          onClick={() => onChange((value || 0) - step)}
          className="btn btn-ghost btn-icon"
          style={{ width: 16, height: 11, borderRadius: 3 }}
        >
          <ChevronDown size={9} />
        </button>
      </div>
    </div>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        MozAppearance: "none",
        height: 26,
        padding: "0 26px 0 9px",
        background: "var(--field-bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        color: "var(--fg)",
        fontSize: "var(--text-sm)",
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2'><path d='M6 9 L12 15 L18 9'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 7px center",
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div style={{ display: "inline-flex" }}>
      {options.map((o, i) => {
        const sel = value === o;
        const isFirst = i === 0;
        const isLast = i === options.length - 1;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className="font-mono text-[length:var(--text-xs)]"
            style={{
              padding: "4px 9px",
              background: sel ? "var(--accent-tint)" : "var(--btn-bg)",
              color: sel ? "var(--accent)" : "var(--fg-muted)",
              border:
                "1px solid " + (sel ? "var(--accent-edge)" : "var(--border)"),
              borderLeftWidth: isFirst ? 1 : 0,
              borderRadius: isFirst
                ? "5px 0 0 5px"
                : isLast
                  ? "0 5px 5px 0"
                  : 0,
              cursor: "pointer",
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function MultiSelect({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const toggle = (o: string) =>
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className="font-mono text-[length:var(--text-xs)]"
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              background: on ? "var(--accent-tint)" : "var(--btn-bg)",
              color: on ? "var(--accent)" : "var(--fg-muted)",
              border:
                "1px solid " + (on ? "var(--accent-edge)" : "var(--border)"),
              cursor: "pointer",
            }}
          >
            {on ? "✓ " : ""}
            {o}
          </button>
        );
      })}
    </div>
  );
}

function SliderDemo({
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-1 items-center gap-3">
      <input
        type="range"
        className="rng"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--val" as string]: `${pct}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span
        className="font-mono text-[length:var(--text-sm)]"
        style={{ width: 58, textAlign: "right" }}
      >
        {step < 1 ? value.toFixed(2) : value}
        {unit && <span className="text-fg-faint"> {unit}</span>}
      </span>
    </div>
  );
}

function ColorSwatches({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      {options.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: c,
            border:
              "2px solid " +
              (value === c ? "var(--accent)" : "var(--border-2)"),
            boxShadow: value === c ? "0 0 0 2px var(--bg)" : "none",
            cursor: "pointer",
          }}
          aria-label={c}
        />
      ))}
    </div>
  );
}

function Tabs({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="flex" style={{ gap: 2 }}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className="font-mono text-[length:var(--text-sm)]"
            style={{
              padding: "6px 10px",
              color: value === o ? "var(--fg)" : "var(--fg-muted)",
              background: "transparent",
              border: "none",
              borderBottom:
                "2px solid " + (value === o ? "var(--accent)" : "transparent"),
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--panel-3)",
            border: "1px solid var(--border-3)",
            borderRadius: 4,
            padding: "3px 7px",
            fontSize: "var(--text-xs)",
            color: "var(--fg)",
            whiteSpace: "nowrap",
            boxShadow: "0 6px 20px -8px rgba(0,0,0,0.5)",
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
