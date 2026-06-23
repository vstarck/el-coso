/* Embed SDK — host side (spec/25). The `Conductor` mounts/locates substrate
 * embeds (as iframes pointing at the guest runtime), owns a global autoplay
 * policy, broadcasts signals, persists the preference, and hands back a per-embed
 * `EmbedRemote` (a remote control over the `coso/v1` protocol).
 *
 * Stays lean in the host bundle: it imports only the protocol (types + guards)
 * and `EmbedConfig` as a TYPE — never `mountSubstrate`, a lens, or the engine. So
 * the SPA pays nothing for substrate code; that all lives in the iframes.
 *
 * Never fails silently: a guest `error` with no listener is logged; an unknown
 * bundle/global is the caller's to provide and surfaces as a guest error. */

import type { EmbedConfig } from "@/embed/mount-substrate";
import type { EmbedCommandSpec, TunableValue } from "@/lenses/types";
import {
  isEnvelope,
  makeEnvelope,
  type DownMessage,
  type TunableManifest,
  type UpMessage,
} from "./protocol";

export type ConductorOptions = {
  /** URL of the guest page (the SDK-built embed.html). */
  runtime: string;
  /** Bundle base; default bundle = `${base}${substrate}/${substrate}-embed.js`.
   *  Overridable per embed via EmbedSpec.bundle. Default "". */
  base?: string;
  /** Allowed postMessage origin (both directions). Default `location.origin`. */
  origin?: string;
  /** Global autoplay policy: initial value + optional localStorage key. */
  autoplay?: { default?: boolean; persist?: string };
};

export type EmbedSpec = {
  substrate: string;
  bundle?: string; // explicit bundle URL (else derived from base)
  global?: string; // mount global; default "CosoEmbed"
  config?: EmbedConfig; // puzzle/seed/speed/tunables/loop/touchAction/…
  title?: string;
  width?: number;
  height?: number;
  /** Per-embed autoplay override. When set, this embed is PINNED — it ignores the
   *  conductor's global toggle. Omit ⇒ follows the conductor policy. */
  autoplay?: boolean;
};

export type EmbedEvent = "ready" | "state" | "error";

export type EmbedRemote = {
  readonly el: HTMLIFrameElement;
  readonly substrate: string;
  play(): void;
  pause(): void;
  toggle(): void;
  reset(): void;
  setLoop(on: boolean): void;
  setTunable(path: string | string[], value: TunableValue): void;
  command(name: string, ...args: unknown[]): void;
  /** Last known play state (from `state`/`mounted` events; false until mounted). */
  isPlaying(): boolean;
  /** Discovery manifest, or null until the guest has mounted. */
  describe(): { lens: string; tunables: TunableManifest[]; commands: EmbedCommandSpec[] } | null;
  on(event: EmbedEvent, cb: (detail: unknown) => void): () => void;
  destroy(): void;
};

export type Conductor = {
  embed(target: HTMLElement | string, spec: EmbedSpec): EmbedRemote;
  /** Scan `root` (default document) for `[data-coso]` elements and embed each. */
  enhance(root?: ParentNode): EmbedRemote[];
  embeds(): EmbedRemote[];
  setAutoplay(on: boolean): void;
  toggleAutoplay(): void;
  autoplay(): boolean;
  playAll(): void;
  pauseAll(): void;
  on(event: "change", cb: (autoplay: boolean) => void): () => void;
  destroy(): void;
};

function readPersisted(key: string | undefined): boolean | undefined {
  if (!key || typeof localStorage === "undefined") return undefined;
  const v = localStorage.getItem(key);
  return v === null ? undefined : v === "true";
}

function writePersisted(key: string | undefined, on: boolean): void {
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, on ? "true" : "false");
  } catch {
    /* storage disabled — preference simply isn't persisted */
  }
}

// Token: only needs to be unguessable enough to ignore stray frames, not crypto.
let tokenSeq = 0;
function mintToken(): string {
  tokenSeq += 1;
  return `c${tokenSeq}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createConductor(opts: ConductorOptions): Conductor {
  const origin = opts.origin ?? location.origin;
  const base = opts.base ?? "";
  const persistKey = opts.autoplay?.persist;
  let policy = readPersisted(persistKey) ?? opts.autoplay?.default ?? true;

  const remotes: RemoteImpl[] = [];
  const changeListeners = new Set<(on: boolean) => void>();

  type RemoteImpl = EmbedRemote & {
    _token: string;
    _pinned: boolean;
    _effective: boolean;
    _ready: boolean;
    _outbox: DownMessage[];
    _lastPlaying: boolean;
    _manifest: { lens: string; tunables: TunableManifest[]; commands: EmbedCommandSpec[] } | null;
    _listeners: Record<EmbedEvent, Set<(d: unknown) => void>>;
    _receive(msg: UpMessage): void;
  };

  function onMessage(ev: MessageEvent): void {
    if (ev.origin !== origin) return;
    if (!isEnvelope(ev.data) || ev.data.dir !== "up") return;
    const remote = remotes.find((r) => r.el.contentWindow === ev.source);
    if (!remote) return; // not one of ours
    if (ev.data.token !== undefined && ev.data.token !== remote._token) return;
    remote._receive(ev.data.msg as UpMessage);
  }
  window.addEventListener("message", onMessage);

  function bundleUrl(spec: EmbedSpec): string {
    return spec.bundle ?? `${base}${spec.substrate}/${spec.substrate}-embed.js`;
  }

  function makeRemote(el: HTMLIFrameElement, spec: EmbedSpec, token: string): RemoteImpl {
    const pinned = spec.autoplay !== undefined;
    const effective = pinned ? (spec.autoplay as boolean) : policy;
    const listeners: RemoteImpl["_listeners"] = { ready: new Set(), state: new Set(), error: new Set() };

    function rawSend(msg: DownMessage): void {
      el.contentWindow?.postMessage(makeEnvelope("down", msg, token), origin);
    }
    function send(msg: DownMessage): void {
      if (remote._ready) rawSend(msg);
      else remote._outbox.push(msg); // flushed once the guest is listening
    }
    function emit(event: EmbedEvent, detail: unknown): void {
      const set = listeners[event];
      if (event === "error" && set.size === 0) {
        // never silent
        console.error("[coso-conductor]", spec.substrate, detail);
      }
      for (const cb of set) cb(detail);
    }

    const remote: RemoteImpl = {
      el,
      substrate: spec.substrate,
      _token: token,
      _pinned: pinned,
      _effective: effective,
      _ready: false,
      _outbox: [],
      _lastPlaying: false,
      _manifest: null,
      _listeners: listeners,
      play: () => send({ kind: "play" }),
      pause: () => send({ kind: "pause" }),
      toggle: () => send({ kind: "toggle" }),
      reset: () => send({ kind: "reset" }),
      setLoop: (on) => send({ kind: "set_loop", on }),
      setTunable: (path, value) =>
        send({ kind: "set_tunable", path: Array.isArray(path) ? path : [path], value }),
      command: (name, ...args) => send({ kind: "command", name, args }),
      isPlaying: () => remote._lastPlaying,
      describe: () => remote._manifest,
      on: (event, cb) => {
        listeners[event].add(cb);
        return () => listeners[event].delete(cb);
      },
      destroy: () => {
        const i = remotes.indexOf(remote);
        if (i >= 0) remotes.splice(i, 1);
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      _receive: (msg) => {
        switch (msg.kind) {
          case "ready": {
            // Guest is listening — send the config (postMessage transport) and
            // flush anything queued before it was ready.
            remote._ready = true;
            const config: EmbedConfig = { ...(spec.config ?? {}), autoplay: remote._effective };
            rawSend({ kind: "init", config });
            const queued = remote._outbox.splice(0, remote._outbox.length);
            for (const m of queued) rawSend(m);
            return;
          }
          case "mounted": {
            remote._lastPlaying = msg.playing;
            remote._manifest = { lens: msg.lens, tunables: msg.tunables, commands: msg.commands };
            // Correct for any policy drift since the iframe was created (the lazy
            // case): re-assert the current effective autoplay.
            rawSend({ kind: "autoplay", on: remote._effective });
            emit("ready", remote._manifest);
            return;
          }
          case "state":
            remote._lastPlaying = msg.playing;
            emit("state", { playing: msg.playing, tick: msg.tick });
            return;
          case "error":
            emit("error", { message: msg.message, requestId: msg.requestId });
            return;
          default:
            emit("error", { message: `unknown up-message: ${String((msg as { kind?: unknown }).kind)}` });
        }
      },
    };
    return remote;
  }

  function embed(target: HTMLElement | string, spec: EmbedSpec): EmbedRemote {
    const host = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    if (!host) throw new Error(`Conductor.embed: target not found (${String(target)})`);

    const token = mintToken();
    const url = new URL(opts.runtime, location.href);
    url.searchParams.set("b", bundleUrl(spec));
    url.searchParams.set("g", spec.global ?? "CosoEmbed");
    url.searchParams.set("s", spec.substrate);
    url.searchParams.set("t", token);
    url.searchParams.set("o", origin);

    const el = document.createElement("iframe");
    el.src = url.toString();
    el.title = spec.title ?? spec.substrate;
    el.loading = "lazy";
    el.setAttribute("sandbox", "allow-scripts allow-same-origin");
    el.style.border = "0";
    if (spec.width !== undefined) el.style.width = `${spec.width}px`;
    if (spec.height !== undefined) el.style.height = `${spec.height}px`;
    host.appendChild(el);

    const remote = makeRemote(el, spec, token);
    remotes.push(remote);
    return remote;
  }

  function enhance(root: ParentNode = document): EmbedRemote[] {
    const out: EmbedRemote[] = [];
    for (const node of Array.from(root.querySelectorAll<HTMLElement>("[data-coso]"))) {
      if (node.dataset.cosoEnhanced === "1") continue;
      node.dataset.cosoEnhanced = "1";
      const substrate = node.dataset.coso;
      if (!substrate) continue;
      let config: EmbedConfig = {};
      if (node.dataset.config) {
        try {
          config = JSON.parse(node.dataset.config) as EmbedConfig;
        } catch (e) {
          console.error("[coso-conductor] bad data-config on", node, e);
          continue;
        }
      }
      if (node.dataset.puzzle) config = { ...config, puzzle: node.dataset.puzzle };
      const spec: EmbedSpec = { substrate, config };
      if (node.dataset.title) spec.title = node.dataset.title;
      out.push(embed(node, spec));
    }
    return out;
  }

  function setAutoplay(on: boolean): void {
    if (on === policy) return;
    policy = on;
    writePersisted(persistKey, on);
    for (const r of remotes) {
      if (r._pinned) continue;
      r._effective = on;
      r.el.contentWindow?.postMessage(
        makeEnvelope("down", { kind: "autoplay", on }, r._token),
        origin,
      );
    }
    for (const cb of changeListeners) cb(on);
  }

  return {
    embed,
    enhance,
    embeds: () => remotes.slice(),
    setAutoplay,
    toggleAutoplay: () => setAutoplay(!policy),
    autoplay: () => policy,
    playAll: () => remotes.forEach((r) => r.play()),
    pauseAll: () => remotes.forEach((r) => r.pause()),
    on: (_event, cb) => {
      changeListeners.add(cb);
      return () => changeListeners.delete(cb);
    },
    destroy: () => {
      window.removeEventListener("message", onMessage);
      for (const r of remotes.slice()) r.destroy();
    },
  };
}
