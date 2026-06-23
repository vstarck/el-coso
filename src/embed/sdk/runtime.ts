/* Embed guest runtime (spec/25) — runs INSIDE the iframe. The maintained,
 * versioned generalization of the hand-rolled `host.html` shim.
 *
 * Lifecycle:
 *   1. Parse URL params (?b bundle, ?g global, ?s substrate, ?t token, ?o parent
 *      origin, ?c optional inline config — back-compat).
 *   2. Install the message listener (origin + token gated) BEFORE loading anything.
 *   3. Inject the substrate bundle <script src=?b>; on load post `ready`.
 *   4. Config arrives by `init` (postMessage, preferred) or `?c` (URL, fallback);
 *      on config + bundle ready → mountSubstrate → post `mounted` (with the
 *      discovery manifest) and begin reporting play-state changes.
 *   5. Dispatch `down` control messages to the EmbedHandle.
 *
 * Never fails silently: an unknown message kind, a missing bundle/global, a mount
 * failure, or a rejected command are all logged AND posted up as `error`.
 */

import type { EmbedConfig, EmbedHandle } from "@/embed/mount-substrate";
import type { LensTunable } from "@/lenses/types";
import {
  isEnvelope,
  makeEnvelope,
  type DownMessage,
  type TunableManifest,
  type UpMessage,
} from "./protocol";

type GuestGlobal = { mount?: (target: HTMLElement | string, config: EmbedConfig) => EmbedHandle };

const STATE_POLL_MS = 250; // play-state is polled (EmbedHandle has no subscribe)

function tunableManifest(tunables: LensTunable[]): TunableManifest[] {
  return tunables.map((t) => {
    const m: TunableManifest = { path: t.path, label: t.label, group: t.group, type: t.type };
    if (t.type === "float" || t.type === "int") {
      if (typeof t.min === "number") m.min = t.min;
      if (typeof t.max === "number") m.max = t.max;
      if (typeof t.step === "number") m.step = t.step;
    }
    if (t.type === "enum" && Array.isArray(t.options)) m.options = t.options.slice();
    return m;
  });
}

export function startEmbedGuest(): void {
  const params = new URLSearchParams(location.search);
  const bundle = params.get("b");
  const globalName = params.get("g") ?? "CosoEmbed";
  const substrate = params.get("s") ?? "unknown";
  const token = params.get("t") ?? undefined;
  const parentOrigin = params.get("o") ?? undefined; // expected parent origin
  const inlineConfigRaw = params.get("c"); // back-compat fallback

  const root =
    document.getElementById("app") ??
    (() => {
      const d = document.createElement("div");
      d.id = "app";
      document.body.appendChild(d);
      return d;
    })();

  let handle: EmbedHandle | null = null;
  let bundleReady = false;
  let pendingConfig: EmbedConfig | null = null;
  const queued: DownMessage[] = []; // control messages that arrived before mount
  let lastPlaying = false;

  function post(msg: UpMessage): void {
    parent.postMessage(makeEnvelope("up", msg, token), parentOrigin ?? "*");
  }

  // Never silent: log to the iframe console AND notify the parent.
  function fail(message: string, requestId?: string): void {
    console.error("[coso-embed]", message);
    post(requestId === undefined ? { kind: "error", message } : { kind: "error", message, requestId });
  }

  function reportStateIfChanged(): void {
    if (!handle) return;
    const playing = handle.isPlaying();
    if (playing !== lastPlaying) {
      lastPlaying = playing;
      post({ kind: "state", playing });
    }
  }

  function tryMount(): void {
    if (handle || !bundleReady || !pendingConfig) return;
    const g = (window as unknown as Record<string, GuestGlobal | undefined>)[globalName];
    if (!g || typeof g.mount !== "function") {
      fail(`global "${globalName}" is missing a mount() function`);
      return;
    }
    try {
      handle = g.mount(root, pendingConfig);
    } catch (e) {
      fail(`mount failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const d = handle.describe();
    lastPlaying = handle.isPlaying();
    post({
      kind: "mounted",
      substrate,
      lens: d.lens,
      playing: lastPlaying,
      tunables: tunableManifest(d.tunables),
      commands: d.commands.slice(),
    });
    // Drain control messages that arrived before mount, then start state polling.
    const pending = queued.splice(0, queued.length);
    for (const m of pending) dispatch(m);
    setInterval(reportStateIfChanged, STATE_POLL_MS);
  }

  function withHandle(msg: DownMessage, fn: (h: EmbedHandle) => void): void {
    if (!handle) {
      queued.push(msg); // applied on mount
      return;
    }
    fn(handle);
    reportStateIfChanged();
  }

  function dispatch(msg: DownMessage): void {
    switch (msg.kind) {
      case "init":
        pendingConfig = msg.config;
        tryMount();
        return;
      case "autoplay":
        withHandle(msg, (h) => (msg.on ? h.play() : h.pause()));
        return;
      case "play":
        withHandle(msg, (h) => h.play());
        return;
      case "pause":
        withHandle(msg, (h) => h.pause());
        return;
      case "toggle":
        withHandle(msg, (h) => h.toggle());
        return;
      case "reset":
        withHandle(msg, (h) => h.reset());
        return;
      case "set_loop":
        withHandle(msg, (h) => h.setLoop(msg.on));
        return;
      case "set_tunable":
        withHandle(msg, (h) => h.setTunable(msg.path, msg.value));
        return;
      case "command":
        withHandle(msg, (h) => {
          try {
            h.command(msg.name, ...msg.args);
          } catch (e) {
            fail(
              `command "${msg.name}" failed: ${e instanceof Error ? e.message : String(e)}`,
              msg.requestId,
            );
          }
        });
        return;
      default:
        // Trusted (origin+token-passed) but unrecognized — surface, never drop.
        fail(`unknown message kind: ${String((msg as { kind?: unknown }).kind)}`);
    }
  }

  window.addEventListener("message", (ev: MessageEvent) => {
    if (parentOrigin !== undefined && ev.origin !== parentOrigin) return; // foreign origin
    if (!isEnvelope(ev.data) || ev.data.dir !== "down") return; // not one of ours
    if (token !== undefined && ev.data.token !== token) return; // wrong/absent token
    dispatch(ev.data.msg as DownMessage);
  });

  if (!bundle) {
    fail("missing bundle URL (?b)");
    return;
  }

  // Back-compat: an inline ?c config means we can mount as soon as the bundle is
  // ready, with no conductor in the loop (the standalone iframe path).
  if (inlineConfigRaw !== null) {
    try {
      pendingConfig = JSON.parse(inlineConfigRaw) as EmbedConfig;
    } catch (e) {
      fail(`bad inline config (?c): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const script = document.createElement("script");
  script.src = bundle;
  script.onload = () => {
    bundleReady = true;
    post({ kind: "ready", substrate }); // tells a conductor to send `init`
    tryMount(); // no-op unless we already have a config (?c)
  };
  script.onerror = () => fail(`failed to load bundle: ${bundle}`);
  document.head.appendChild(script);
}
