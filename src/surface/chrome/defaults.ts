/* The standard pieces and the default dashboard (spec/32 §6 — the owner, S248: "the minimal swarm swart art like
 * implementation could be a nice default (playback controls, picture, etc)"). Plain declarations: a substrate can
 * reorder, relabel, re-slot or drop each one. */
import { UI_MODES, validateDashboard, type Control, type Dashboard, type UiMode } from "./decl";
import type { Chrome } from "./chrome";

export const ICON = {
  restart: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>',
  step: '<svg viewBox="0 0 24 24"><path d="M6 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M18 5v14" stroke-width="2.5"/></svg>',
  eyeAuto: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeLabels: '<svg viewBox="0 0 24 24"><path d="M2 10s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 10 2 10z"/><circle cx="12" cy="10" r="2.5"/><path d="M6 20h12"/></svg>',
  download: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-8 9"/></svg>',
};

export function transport(): Control[] {
  return [
    { kind: "button", id: "restart", label: "restart", icon: ICON.restart },
    { kind: "cycle", id: "play", label: "pause", big: true, states: [
      { id: "playing", icon: ICON.pause, label: "pause" },
      { id: "paused", icon: ICON.play, label: "play" },
    ] },
    { kind: "button", id: "step", label: "step", icon: ICON.step },
  ];
}
const MODE_LABEL: Record<UiMode, string> = { auto: "UI: auto", always_on: "UI: always on", "always_on+labels": "UI: labels" };
const MODE_ICON: Record<UiMode, string> = { auto: ICON.eyeAuto, always_on: ICON.eye, "always_on+labels": ICON.eyeLabels };
export function eye(): Control {
  return { kind: "cycle", id: "ui-mode", label: MODE_LABEL.auto, states: UI_MODES.map((m) => ({ id: m, icon: MODE_ICON[m], label: MODE_LABEL[m] })) };
}
export function download(): Control {
  return { kind: "button", id: "download", label: "download image", icon: ICON.download };
}
export function defaultDashboard(): Dashboard {
  return validateDashboard({
    slots: {
      bottom: { controls: transport(), vignette: true },
      "top-left": { controls: [eye()] },
      "top-right": { controls: [download()] },
    },
    behaviour: { idleSeconds: 2.5 },
    theme: {},
    footer: null,
  });
}
/** the play control and the "paused" pin move together (swarm-swart-grid's setPlaying, S241) */
export function setPlaying(chrome: Chrome, playing: boolean): void {
  chrome.set("play", { state: playing ? "playing" : "paused" });
  chrome.pin("paused", !playing);
  if (!playing) chrome.poke();
}
/** the mode and the eye move together */
export function setUiMode(chrome: Chrome, m: UiMode): void {
  chrome.setMode(m);
  if (chrome.has("ui-mode")) chrome.set("ui-mode", { state: m });
}
