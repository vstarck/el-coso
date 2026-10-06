/* The chrome renderer (spec/32 §5.1; S248) — grown from swarm-swart-grid's S241 chrome, which "knows nothing about the
 * simulation". It renders a DASHBOARD (./decl): bars in slots, controls by kind, flyouts, a footer strip, a vignette,
 * retract-on-idle with pins, three UI modes. It reports presses by id and holds no substrate state.
 *
 * ★ THE STATE IS AN ATTRIBUTE, NOT A CLASS: `data-visible` / `data-mode` on the root, `data-on` / `data-state` on a
 * control. The CSS keys on them, so a smoke can READ and FORCE state without knowing a class name.
 * RETRACT (S241–S242, the owner): any input inside the embed — pointer press, wheel, key — shows the controls and
 * restarts the idle timer; the host lens pokes on pointer moves. Nothing reads enter/leave or focus/blur (inside an
 * iframe a leave can be lost). PINS (strings: "paused", "flyout", "mode", or a substrate's own) hold them up. */
import { validateDashboard, validateFlyout, type Control, type Dashboard, type Slot, type UiMode } from "./decl";
import { drawFooter, footerHeight, layoutFooter } from "./footer";

/** `input` is required as soon as a slider is mounted (a controls flyout is the only place one lives, S251): a slider
 *  with nobody listening would be a dead control, so the chrome refuses it rather than render it (S249). */
export type ChromeEvents = { press: (id: string) => void; input?: (id: string, value: number) => void };
export type ControlPatch = { on?: boolean; state?: string; label?: string; icon?: string; hidden?: boolean; disabled?: boolean; value?: number };
/** `title`: the item's tooltip (wacha's world picker shows each preset's note, S249) */
export type FlyoutItem = { id: string; label: string; title?: string; thumb?: HTMLCanvasElement; active: boolean };
/** A flyout body: a grid of pickable items, or controls (built like the slots' and in the chrome's id space while open). */
export type Flyout = { title: string; items: FlyoutItem[]; onPick: (id: string) => void } | { title: string; controls: Control[] };
export type Chrome = {
  root: HTMLDivElement;
  stage: HTMLDivElement;
  thumbs: Record<string, HTMLCanvasElement>;
  footerHeight: number;
  setCanvas: (c: HTMLCanvasElement) => void;
  paintFooter: (ctx: CanvasRenderingContext2D, y0: number, k: number, cssWidth: number) => void;
  footerText: () => string;
  has: (id: string) => boolean;
  set: (id: string, patch: ControlPatch) => void;
  setScale: (s: number) => void;
  setVignette: (v: number) => void;
  setMode: (m: UiMode) => void;
  setIdle: (seconds: number) => void;
  openFlyout: (anchorId: string, f: Flyout) => void;
  closeFlyout: () => void;
  pin: (why: string, on: boolean) => void;
  poke: () => void;
  toggleVisible: () => void;
  isVisible: () => boolean;
  destroy: () => void;
};

export const IDLE_MS = 2500;
const THUMB = 40; // CSS px of a thumb control's face

const CSS = `
/* S248 review I5: every slot / direction rule is scoped under .ec-root (they matched any [data-slot] on the host page).
   The accent is an RGB triplet for its translucent uses — rgba(var()) works everywhere color-mix does not, and paints
   exactly swarm-swart-grid's old rgba(224,164,88,.28). */
/* every CONTROL dimension is × var(--s), the UI scale (the lens's ui_scale tunable); the root and the footer are not
   — the footer's height is part of the embed's natural size */
.ec-root{--s:1;--v:.6;--ec-accent:#e0a458;--ec-accent-rgb:224,164,88;position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:#050505;overflow:hidden;
  font:500 12px/1.3 system-ui,-apple-system,sans-serif;color:#e7e2d8;-webkit-tap-highlight-color:transparent}
.ec-root>canvas{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0}
/* the stage lies OVER the canvas: pointer events pass through it to the canvas, except on its controls */
.ec-stage{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;z-index:1;pointer-events:none}
.ec-stage>*{pointer-events:auto}
.ec-vig{position:absolute;pointer-events:none;z-index:1;opacity:var(--v);transition:opacity .28s ease}
.ec-root[data-visible="false"] .ec-vig{opacity:0}
.ec-vig-left{left:0;top:0;bottom:0;width:calc(150px*var(--s));background:radial-gradient(100% 42% at 0% 50%,rgba(0,0,0,.8),rgba(0,0,0,0))}
.ec-vig-right{right:0;top:0;bottom:0;width:calc(150px*var(--s));background:radial-gradient(100% 42% at 100% 50%,rgba(0,0,0,.8),rgba(0,0,0,0))}
.ec-vig-bottom{left:0;right:0;bottom:0;height:calc(130px*var(--s));background:radial-gradient(34% 100% at 50% 100%,rgba(0,0,0,.8),rgba(0,0,0,0))}
.ec-bar{position:absolute;display:flex;gap:calc(5px*var(--s));align-items:center;transition:transform .28s ease,opacity .28s ease;z-index:2}
.ec-root [data-slot="left"]{left:calc(12px*var(--s));top:50%;flex-direction:column;transform:translateY(-50%)}
.ec-root [data-slot="right"]{right:calc(12px*var(--s));top:50%;flex-direction:column;transform:translateY(-50%)}
.ec-root [data-slot="bottom"]{left:50%;bottom:calc(14px*var(--s));transform:translateX(-50%)}
.ec-root [data-slot="top-left"]{left:calc(12px*var(--s));top:calc(12px*var(--s))}
.ec-root[data-visible="false"] [data-slot="top-left"]{transform:translate(-160%,0);opacity:0}
.ec-root [data-slot="top-right"]{right:calc(12px*var(--s));top:calc(12px*var(--s))}
.ec-root[data-visible="false"] [data-slot="top-right"]{transform:translate(160%,0);opacity:0}
.ec-root[data-visible="false"] [data-slot="left"]{transform:translate(-160%,-50%);opacity:0}
.ec-root[data-visible="false"] [data-slot="right"]{transform:translate(160%,-50%);opacity:0}
.ec-root[data-visible="false"] [data-slot="bottom"]{transform:translate(-50%,160%);opacity:0}
.ec-cell{position:relative;display:flex}
.ec-cell[hidden]{display:none} /* the class's display:flex would otherwise beat the attribute */
.ec-label{position:absolute;display:none;white-space:nowrap;pointer-events:none;z-index:1;color:#f2eee6;background:rgba(10,10,12,.74);
  font:600 calc(11px*var(--s))/1 system-ui,-apple-system,sans-serif;letter-spacing:.02em;padding:calc(4px*var(--s)) calc(7px*var(--s));border-radius:calc(6px*var(--s))}
.ec-root[data-mode="always_on+labels"] .ec-label{display:block}
.ec-root [data-slot="left"] .ec-label,.ec-root [data-slot="top-left"] .ec-label{left:calc(100% + 8px*var(--s));top:50%;transform:translateY(-50%)}
.ec-root [data-slot="right"] .ec-label,.ec-root [data-slot="top-right"] .ec-label{right:calc(100% + 8px*var(--s));top:50%;transform:translateY(-50%)}
.ec-root [data-slot="bottom"] .ec-label{bottom:calc(100% + 6px*var(--s));left:50%;transform:translateX(-50%)}
.ec-root [data-slot="bottom"] .ec-cell{align-self:stretch;align-items:center} /* every bottom cell spans the bar, so the labels share one line */
.ec-btn{width:calc(44px*var(--s));height:calc(44px*var(--s));border-radius:50%;border:1px solid rgba(255,255,255,.22);background:rgba(12,12,14,.55);
  backdrop-filter:blur(calc(6px*var(--s)));-webkit-backdrop-filter:blur(calc(6px*var(--s)));color:#f2eee6;display:flex;align-items:center;justify-content:center;
  padding:0;cursor:pointer;box-shadow:0 calc(2px*var(--s)) calc(10px*var(--s)) rgba(0,0,0,.35);transition:border-color .15s,background .15s,transform .1s;overflow:hidden}
.ec-btn:hover{border-color:rgba(255,255,255,.55)}
.ec-btn:active{transform:scale(.94)}
.ec-btn[data-on="true"]{border-color:var(--ec-accent);background:rgba(var(--ec-accent-rgb),.28)}
.ec-btn:disabled{opacity:.35;cursor:default}
.ec-btn:disabled:hover{border-color:rgba(255,255,255,.22)}
.ec-btn.ec-big{width:calc(56px*var(--s));height:calc(56px*var(--s))}
.ec-btn svg{width:calc(20px*var(--s));height:calc(20px*var(--s));fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ec-btn canvas{width:calc(${THUMB}px*var(--s));height:calc(${THUMB}px*var(--s));border-radius:50%;display:block}
.ec-thumb[data-on="true"]{border:calc(2px*var(--s)) solid var(--ec-accent);box-shadow:0 0 0 calc(3px*var(--s)) rgba(var(--ec-accent-rgb),.25),0 calc(2px*var(--s)) calc(10px*var(--s)) rgba(0,0,0,.35)}
.ec-fly{position:absolute;max-height:calc(100% - calc(24px*var(--s)));overflow:auto;z-index:3;
  background:rgba(12,12,14,.82);backdrop-filter:blur(calc(8px*var(--s)));-webkit-backdrop-filter:blur(calc(8px*var(--s)));border:1px solid rgba(255,255,255,.18);
  border-radius:calc(12px*var(--s));padding:calc(10px*var(--s));display:none;width:min(calc(252px*var(--s)),calc(100% - calc(92px*var(--s))))}
.ec-fly[data-open="true"]{display:block}
.ec-fly[data-side="left"]{left:calc(68px*var(--s));top:50%;transform:translateY(-50%)}
.ec-fly[data-side="right"]{right:calc(68px*var(--s));top:50%;transform:translateY(-50%)}
.ec-fly[data-side="bottom"]{bottom:calc(84px*var(--s));left:50%;transform:translateX(-50%)}
.ec-fly[data-side="top"]{top:calc(68px*var(--s));left:50%;transform:translateX(-50%)}
.ec-fly h3{margin:0 calc(2px*var(--s)) calc(8px*var(--s));font:600 calc(11px*var(--s))/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#a39d92}
.ec-fly-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(64px*var(--s)),1fr));gap:calc(8px*var(--s))}
.ec-item{display:flex;flex-direction:column;align-items:center;gap:calc(4px*var(--s));padding:calc(6px*var(--s)) calc(2px*var(--s));border-radius:calc(8px*var(--s));border:1px solid transparent;
  background:none;color:#d8d2c7;cursor:pointer;font:500 calc(11px*var(--s))/1.15 system-ui,sans-serif;text-align:center}
.ec-item:hover{background:rgba(255,255,255,.07)}
.ec-item[data-on="true"]{border-color:var(--ec-accent);color:#fff}
.ec-item canvas{width:calc(48px*var(--s));height:calc(48px*var(--s));border-radius:calc(8px*var(--s));display:block}
.ec-item .ec-glyph{width:calc(48px*var(--s));height:calc(48px*var(--s));border-radius:calc(8px*var(--s));display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06)}
/* the footer is DRAWN on the canvas; this box only reserves its strip (and holds its text for screen readers) */
.ec-foot{position:relative;z-index:1;flex:0 0 var(--ec-foot);height:var(--ec-foot);overflow:hidden;pointer-events:none}
.ec-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ec-root [data-slot="top"]{left:50%;top:calc(12px*var(--s));transform:translateX(-50%)}
.ec-root[data-visible="false"] [data-slot="top"]{transform:translate(-50%,-160%);opacity:0}
.ec-root [data-slot="bottom-left"]{left:calc(12px*var(--s));bottom:calc(14px*var(--s))}
.ec-root[data-visible="false"] [data-slot="bottom-left"]{transform:translate(-160%,0);opacity:0}
.ec-root [data-slot="bottom-right"]{right:calc(12px*var(--s));bottom:calc(14px*var(--s))}
.ec-root[data-visible="false"] [data-slot="bottom-right"]{transform:translate(160%,0);opacity:0}
.ec-root [data-slot="top"] .ec-label{top:calc(100% + 6px*var(--s));left:50%;transform:translateX(-50%)}
.ec-root [data-slot="bottom-left"] .ec-label{left:calc(100% + 8px*var(--s));top:50%;transform:translateY(-50%)}
.ec-root [data-slot="bottom-right"] .ec-label{right:calc(100% + 8px*var(--s));top:50%;transform:translateY(-50%)}
.ec-root [data-direction="row"]{flex-direction:row}
.ec-root [data-direction="column"]{flex-direction:column}
.ec-custom{display:flex;align-items:center;justify-content:center}
.ec-fly-controls{display:flex;flex-direction:column;gap:calc(10px*var(--s))}
.ec-fly-controls>.ec-cell>*{flex:1 1 auto;min-width:0} /* a cell is a flex ROW: without this a slider shrinks to its label (S249) */
.ec-slider{display:grid;grid-template-columns:1fr auto;gap:calc(4px*var(--s)) calc(8px*var(--s));align-items:center;color:#d8d2c7;
  font:500 calc(12px*var(--s))/1.2 system-ui,sans-serif}
.ec-slider output{font-variant-numeric:tabular-nums;color:#a39d92}
.ec-slider input{grid-column:1/-1;width:100%;margin:0;height:calc(20px*var(--s));accent-color:var(--ec-accent);cursor:pointer}
.ec-slider input:disabled{opacity:.35;cursor:default}
`;

/** The fixed order bars are appended in — swarm-swart-grid's (top-left, top-right, left, right, bottom), then the
 *  three it never used. Stacking follows DOM order; changing it changes which bar draws over which. */
const BAR_ORDER: readonly Slot[] = ["top-left", "top-right", "left", "right", "bottom", "top", "bottom-left", "bottom-right"];
const SIDE: Record<Slot, "left" | "right" | "top" | "bottom"> = {
  left: "left", "top-left": "left", "bottom-left": "left", right: "right", "top-right": "right", "bottom-right": "right", top: "top", bottom: "bottom",
};
/** what `set` accepts per kind — exported so a binding's patches are checked against this table, not a copy */
export const CONTROL_PATCH_KEYS: Record<Control["kind"], readonly (keyof ControlPatch)[]> = {
  button: ["label", "icon", "hidden", "disabled"],
  toggle: ["on", "state", "label", "icon", "hidden", "disabled"],
  cycle: ["state", "label", "hidden", "disabled"], // label: a bound cycle says "<label>: custom" when the knob sits on no state (S249)
  thumb: ["on", "label", "hidden", "disabled"],
  custom: ["label", "hidden"],
  slider: ["value", "label", "hidden", "disabled"],
};

const sliderInput = (el: HTMLElement): HTMLInputElement | undefined =>
  el.querySelector<HTMLInputElement>('input[type="range"]') ?? undefined;

function sizeThumb(c: HTMLCanvasElement, scale: number): void {
  const dpr = Math.min(2, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  c.width = Math.max(8, Math.round(THUMB * scale * dpr));
  c.height = c.width;
}

export function mountChrome(container: HTMLElement, dashboard: Dashboard, events: ChromeEvents): Chrome {
  const dash = validateDashboard(dashboard);           // ⚠ BEFORE any DOM: a refused declaration mounts nothing
  const needsInput = (cs: readonly Control[]) => {
    const s = cs.find((c) => c.kind === "slider");
    if (s && !events.input) throw new Error(`chrome: slider "${s.id}" needs an input handler (events.input)`);
  };
  const footH = dash.footer ? footerHeight(dash.footer.qr.rows.length) : 0;
  const style = document.createElement("style");
  style.textContent = CSS;
  const root = document.createElement("div");
  root.className = "ec-root";
  root.dataset.role = "chrome";
  root.dataset.visible = "true";
  root.dataset.mode = "auto";
  root.style.setProperty("--ec-foot", `${footH}px`);
  if (dash.theme.accent) {
    const h = dash.theme.accent; // validated #rrggbb
    root.style.setProperty("--ec-accent", h);
    root.style.setProperty("--ec-accent-rgb", [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(","));
  }
  root.appendChild(style);
  const stage = document.createElement("div");
  stage.className = "ec-stage";
  stage.dataset.role = "stage";
  root.appendChild(stage);

  type Entry = { decl: Control; slot: Slot; btn: HTMLElement; cell: HTMLDivElement; label: HTMLSpanElement; input?: HTMLInputElement | undefined; cleanup?: () => void };
  const entries = new Map<string, Entry>();
  const thumbs: Record<string, HTMLCanvasElement> = {};
  const vignettes: HTMLDivElement[] = [];
  const bars: HTMLDivElement[] = [];
  for (const slot of BAR_ORDER) {
    const s = dash.slots[slot];
    if (!s) continue;
    if (s.vignette === true) {
      const v = document.createElement("div");
      v.className = `ec-vig ec-vig-${slot}`;
      v.dataset.role = `vignette-${slot}`;
      vignettes.push(v);
    }
    const bar = document.createElement("div");
    bar.className = "ec-bar";
    bar.dataset.slot = slot;
    if (s.direction) bar.dataset.direction = s.direction;
    for (const c of s.controls) {
      const btn = buildControl(c);
      const cell = document.createElement("div");
      cell.className = "ec-cell";
      const label = document.createElement("span");
      label.className = "ec-label";
      label.dataset.role = `label-${c.id}`;
      label.textContent = c.kind === "cycle" ? c.states[0]!.label : c.label;
      cell.append(btn, label);
      if (c.hidden) cell.hidden = true;
      bar.appendChild(cell);
      const e: Entry = { decl: c, slot, btn, cell, label, input: sliderInput(btn) };
      if (c.kind === "custom") e.cleanup = c.mount(btn);
      entries.set(c.id, e);
    }
    bars.push(bar);
  }
  const fly = document.createElement("div");
  fly.className = "ec-fly";
  fly.dataset.role = "flyout";
  fly.dataset.open = "false";
  stage.append(...vignettes, ...bars, fly);

  const foot = document.createElement("div");
  foot.className = "ec-foot";
  foot.dataset.role = "footer";
  const footText = document.createElement("span");
  footText.className = "ec-sr";
  foot.appendChild(footText);
  const srText = dash.footer
    ? `Sources: ${dash.footer.sources.map((s) => `${s.title} — ${s.detail}`).join("; ")}. ${dash.footer.caption} (QR code).`
    : "";
  footText.textContent = srText;
  if (dash.footer) root.appendChild(foot);
  container.appendChild(root);

  function buildControl(c: Control): HTMLElement {
    if (c.kind === "slider") {
      const el = document.createElement("label");
      el.className = "ec-slider";
      el.dataset.role = c.id;
      const name = document.createElement("span");
      name.className = "ec-slider-name";
      name.textContent = c.label;
      const out = document.createElement("output");
      const inp = document.createElement("input");
      inp.type = "range";
      inp.min = String(c.min); inp.max = String(c.max); inp.step = String(c.step);
      inp.setAttribute("aria-label", c.label);
      out.textContent = inp.value;
      if (c.disabled) inp.disabled = true;
      // ⚠ the output follows the USER's drag here and the substrate's value in set(); the knob itself is never held
      inp.addEventListener("input", () => { out.textContent = inp.value; events.input!(c.id, Number(inp.value)); });
      el.append(name, out, inp);
      return el;
    }
    if (c.kind === "custom") {
      const el = document.createElement("div");
      el.className = "ec-custom";
      el.dataset.role = c.id;
      el.setAttribute("aria-label", c.label);
      return el;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = `ec-btn${c.kind === "thumb" ? " ec-thumb" : ""}${"big" in c && c.big ? " ec-big" : ""}`;
    b.dataset.role = c.id;
    const label = c.kind === "cycle" ? c.states[0]!.label : c.label;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (c.kind === "button" || c.kind === "toggle") b.innerHTML = c.icon;
    if (c.kind === "cycle") { b.innerHTML = c.states[0]!.icon; b.dataset.state = c.states[0]!.id; }
    if (c.kind === "toggle") { b.dataset.on = "false"; b.setAttribute("aria-pressed", "false"); }
    if (c.kind === "thumb") {
      const cv = document.createElement("canvas");
      sizeThumb(cv, 1);
      b.appendChild(cv);
      thumbs[c.id] = cv;
    }
    if (c.disabled) b.disabled = true;
    b.addEventListener("click", () => events.press(c.id));
    return b;
  }
  const relabel = (e: Entry, text: string) => {
    if (e.btn.getAttribute("aria-label") === text) return; // called every few frames: touch the DOM only on a change
    e.btn.setAttribute("aria-label", text);
    e.btn.title = text;
    e.label.textContent = text;
    const name = e.btn.querySelector(".ec-slider-name");
    if (name && name !== e.label) name.textContent = text;
  };

  // --- retract (verbatim logic from swarm-swart-grid's chrome; the state is now the attribute)
  const pins = new Set<string>();
  let visible = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleMs = dash.behaviour.idleSeconds * 1000;
  const apply = () => { root.dataset.visible = String(visible); };
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (pins.size === 0) { visible = false; apply(); } }, idleMs);
  };
  const show = () => { visible = true; apply(); arm(); };
  const onInputDown = (e: PointerEvent) => { if (!(e.pointerType === "touch" && e.target instanceof HTMLCanvasElement)) show(); };
  root.addEventListener("pointerdown", onInputDown, true);
  root.addEventListener("wheel", show, { passive: true });
  root.addEventListener("keydown", show);
  arm();

  let openAnchor: HTMLElement | null = null;
  /** the ids a controls flyout registered: they leave the id space when it closes (set() on them then throws) */
  let flyIds: string[] = [];
  const dropFlyControls = () => { for (const id of flyIds) entries.delete(id); flyIds = []; };
  const closeFlyout = () => {
    fly.dataset.open = "false";
    fly.replaceChildren();
    dropFlyControls();
    openAnchor = null;
    pins.delete("flyout");
    arm();
  };
  const onDocDown = (e: PointerEvent) => {
    if (!openAnchor) return;
    const t = e.target as Node;
    if (!fly.contains(t) && !openAnchor.contains(t)) closeFlyout();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && openAnchor) closeFlyout(); };
  document.addEventListener("pointerdown", onDocDown, true);
  document.addEventListener("keydown", onKey);

  const entry = (id: string): Entry => {
    const e = entries.get(id);
    if (!e) throw new Error(`chrome: no control "${id}" (declared: ${[...entries.keys()].join(", ")})`);
    return e;
  };

  return {
    root, stage, thumbs, footerHeight: footH,
    setCanvas(c) { c.dataset.role = "canvas"; root.insertBefore(c, stage); },
    paintFooter(ctx, y0, k, cssWidth) {
      if (!dash.footer) throw new Error("chrome: this dashboard declares no footer");
      const lay = layoutFooter((s, font) => { ctx.font = font; return ctx.measureText(s).width; }, cssWidth, dash.footer.sources, dash.footer.caption, dash.footer.qr.rows.length);
      drawFooter(ctx, lay, y0, k, dash.footer.qr.rows);
    },
    footerText: () => srText,
    has: (id) => entries.has(id),
    set(id, patch) {
      const e = entry(id);
      for (const k of Object.keys(patch) as (keyof ControlPatch)[]) {
        if (!CONTROL_PATCH_KEYS[e.decl.kind].includes(k)) throw new Error(`chrome: "${id}" (${e.decl.kind}) has no ${k}`);
      }
      if (patch.hidden !== undefined) e.cell.hidden = patch.hidden;
      if (patch.disabled !== undefined && e.btn instanceof HTMLButtonElement) e.btn.disabled = patch.disabled;
      if (patch.on !== undefined) {
        e.btn.dataset.on = String(patch.on);
        if (e.decl.kind === "toggle") e.btn.setAttribute("aria-pressed", String(patch.on));
      }
      if (patch.icon !== undefined && e.btn.dataset.icon !== patch.icon) { e.btn.dataset.icon = patch.icon; e.btn.innerHTML = patch.icon; }
      if (patch.state !== undefined && (e.decl.kind === "cycle" || e.decl.kind === "toggle")) {
        const states = e.decl.states ?? [];
        const st = states.find((s) => s.id === patch.state);
        if (!st) throw new Error(`chrome: "${id}" has no state "${patch.state}" (states: ${states.map((s) => s.id).join(", ") || "none declared"})`);
        if (e.btn.dataset.state !== st.id) { e.btn.dataset.state = st.id; e.btn.innerHTML = st.icon; }
        relabel(e, st.label);
      }
      if (patch.label !== undefined) relabel(e, patch.label);
      if (patch.value !== undefined && e.input) {
        // ⚠ NO input event: a programmatic set is the reverse channel, not a user write — firing would loop back
        // through a binding into the knob it just read (S249)
        e.input.value = String(patch.value);
        const out = e.btn.querySelector("output");
        if (out) out.textContent = e.input.value;
      }
      if (patch.disabled !== undefined && e.input) e.input.disabled = patch.disabled;
    },
    setScale(sc) { root.style.setProperty("--s", String(sc)); for (const c of Object.values(thumbs)) sizeThumb(c, sc); },
    setVignette(v) { root.style.setProperty("--v", String(v)); },
    setMode(m: UiMode) {
      root.dataset.mode = m;
      if (m === "auto") { pins.delete("mode"); arm(); } else { pins.add("mode"); show(); }
    },
    setIdle(seconds) { idleMs = Math.max(0, seconds) * 1000; arm(); },
    openFlyout(anchorId, f) {
      const anchor = entry(anchorId);
      if (openAnchor === anchor.btn) { closeFlyout(); return; } // the same button toggles it shut
      // ⚠ validated BEFORE the open flyout is touched, against the ids the dashboard holds (not the outgoing flyout's);
      // every level's keys are refused, a picker's and its items' included (S251)
      validateFlyout(f, new Set([...entries.keys()].filter((id) => !flyIds.includes(id))));
      if ("controls" in f) needsInput(f.controls);
      fly.replaceChildren();
      dropFlyControls();
      fly.dataset.side = SIDE[anchor.slot];
      const h = document.createElement("h3");
      h.textContent = f.title;
      if ("controls" in f) {
        const body = document.createElement("div");
        body.className = "ec-fly-controls";
        for (const c of f.controls) {
          const el = buildControl(c);
          const cell = document.createElement("div");
          cell.className = "ec-cell";
          cell.appendChild(el);
          const name = el.querySelector<HTMLSpanElement>(".ec-slider-name") ?? document.createElement("span");
          entries.set(c.id, { decl: c, slot: anchor.slot, btn: el, cell, label: name, input: sliderInput(el) });
          flyIds.push(c.id);
          body.appendChild(cell);
        }
        fly.append(h, body);
        fly.dataset.open = "true";
        openAnchor = anchor.btn;
        pins.add("flyout");
        show();
        return;
      }
      const grid = document.createElement("div");
      grid.className = "ec-fly-grid";
      for (const it of f.items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ec-item";
        b.dataset.id = it.id;
        b.dataset.on = String(it.active);
        if (it.title !== undefined) b.title = it.title;
        if (it.thumb) b.appendChild(it.thumb);
        else { const g = document.createElement("div"); g.className = "ec-glyph"; g.textContent = "↻"; b.appendChild(g); }
        const l = document.createElement("span");
        l.textContent = it.label;
        b.appendChild(l);
        b.addEventListener("click", () => { closeFlyout(); f.onPick(it.id); });
        grid.appendChild(b);
      }
      fly.append(h, grid);
      fly.dataset.open = "true";
      openAnchor = anchor.btn;
      pins.add("flyout");
      show();
    },
    closeFlyout,
    pin(why, on) { if (on) pins.add(why); else { pins.delete(why); arm(); } },
    poke: show,
    toggleVisible() { visible = pins.size > 0 ? true : !visible; apply(); if (visible) arm(); },
    isVisible: () => visible,
    destroy() {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
      for (const e of entries.values()) e.cleanup?.();
      root.remove();
    },
  };
}
