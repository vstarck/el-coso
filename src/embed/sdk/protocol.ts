/* coso/v1 — the embed SDK message protocol (spec/25).
 *
 * Pure module: types, the version tag, and shape guards. Shared by both halves —
 * the host `conductor` (bundled into the consuming page) and the iframe `runtime`
 * (built into dist-embed/embed.html). No DOM, no substrate code, so the conductor
 * stays lean (it never pulls a lens or the engine into the host document).
 *
 * Two channels share one window bus; `dir` disambiguates ("down" = host→guest,
 * "up" = guest→host). Every message is wrapped in an Envelope tagged with the
 * protocol version + an optional per-embed token, so a frame ignores foreign
 * postMessages (security) — but a WELL-FORMED, trusted message of an UNKNOWN kind
 * is surfaced as an error by the dispatcher, never silently dropped (spec point 1).
 */

import type { EmbedCommandSpec, TunableValue } from "@/lenses/types";
import type { EmbedConfig } from "@/embed/mount-substrate";

export const COSO_PROTOCOL = "coso/v1";

/** ★ Capabilities a guest ADVERTISES about itself (spec/25 §12.2c).
 *
 *  Every exported `guest.html` INLINES this runtime, so a published embed
 *  carries a frozen copy of this protocol and cannot be fixed by rebuilding.
 *  A host must therefore never infer what a guest can do from its substrate
 *  id, its manifest, or the mere fact that it answered — it asks, and an old
 *  guest that says nothing is treated as saying "no".
 *
 *  ★ THIS IS WHY THE VERSION IS NOT BUMPED. `isEnvelope` gates on strict
 *  equality of `proto`, so a `coso/v2` would make old guests and new hosts
 *  ignore each other in SILENCE — the one deliberate silent drop in this
 *  protocol is aimed at foreign frames, and version skew between our own
 *  artifacts would inherit it. Additive change + advertised capability keeps
 *  an un-redeployed embed working with reduced capability instead of dead. */
export const PROTOCOL_FEATURES = ["await_commands"] as const;
export type ProtocolFeature = (typeof PROTOCOL_FEATURES)[number];

// A tunable as advertised to the host at mount (subset of the lens's LensTunable).
export type TunableManifest = {
  path: string[];
  label: string;
  group?: string;
  /** The lens's `Rule.public` — whether this knob is meant for a PUBLIC surface.
   *
   *  ⚠ ADDITIVE, and an embed built before this field existed simply omits it. A host
   *  must therefore read `public === true` and never `!== false`: absent means "this
   *  guest does not say", which is the same answer as "no" and deliberately so.
   *  Group-name filtering was the previous approximation and it does not fit — one
   *  substrate's ticks split two of its groups down the middle. */
  public?: boolean;
  type: "float" | "int" | "bool" | "enum";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** The lens's `Rule.public_options` — which of `options` a public surface should
   *  OFFER. Absent ⇒ the guest does not say ⇒ offer all of `options`, exactly as
   *  hosts behaved before this field existed. `options` is still the validation set:
   *  this hides a choice from a menu, it does not make it unsettable. */
  public_options?: string[];
  /** spec/32 D3 (S248): the lens's own declaration, carried whole. Additive — a guest built before S248 omits them. */
  id?: string;
  target?: "config" | "lens";
  curve?: "linear" | "signed-cubic";
  unit?: string;
  display?: "segmented" | "list";
};

// host → guest
export type DownMessage =
  | { kind: "init"; config: EmbedConfig }
  | { kind: "autoplay"; on: boolean }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "toggle" }
  | { kind: "reset" }
  | { kind: "set_loop"; on: boolean }
  | { kind: "set_tunable"; path: string[]; value: TunableValue }
  | { kind: "command"; name: string; args: unknown[]; requestId?: string };

// guest → host
export type UpMessage =
  | { kind: "ready"; substrate: string } // loaded + listening, awaiting config
  | {
      kind: "mounted"; // substrate mounted; carries the discovery manifest
      substrate: string;
      lens: string;
      playing: boolean;
      tunables: TunableManifest[];
      commands: EmbedCommandSpec[];
      // What this guest can do beyond the original coso/v1 surface. ABSENT ⇒ a
      // guest built before spec/25 §12 — the host must degrade, not assume.
      features?: string[];
    }
  // Live host-relevant state, pushed whenever play-state OR any declared tunable
  // changes (incl. from inside the substrate — a console toggle, player takeover).
  // `tunables` is a full snapshot keyed by dotted path; the host APPLIES it to its
  // controls (no diffing, no re-query). Sent once right after `mounted` for the
  // initial values, then on every change.
  | {
      kind: "state";
      playing: boolean;
      tick?: number;
      tunables: Record<string, TunableValue>;
    }
  // A command finished. Correlated by `requestId`; `value` is the lens's
  // returned string, if it returned one. Sent for BOTH sync and async
  // commands, so a host never has to know which it asked for. A failure is
  // reported as `error` with the same `requestId` — the two are exclusive.
  | { kind: "result"; requestId: string; value?: string }
  | { kind: "error"; message: string; requestId?: string };

export type Direction = "down" | "up";

export type Envelope = {
  proto: typeof COSO_PROTOCOL;
  dir: Direction;
  token?: string;
  msg: DownMessage | UpMessage;
};

export function makeEnvelope(
  dir: Direction,
  msg: DownMessage | UpMessage,
  token?: string,
): Envelope {
  return token === undefined
    ? { proto: COSO_PROTOCOL, dir, msg }
    : { proto: COSO_PROTOCOL, dir, token, msg };
}

// Structural guard — true iff `x` is one of our envelopes (right version, a valid
// direction, and a `{ kind: string }` message). Deliberately shallow: it gates
// foreign frames out; per-kind payload validation + unknown-kind surfacing happen
// at dispatch so a malformed-but-ours message becomes a visible error, not a drop.
export function isEnvelope(x: unknown): x is Envelope {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  if (e.proto !== COSO_PROTOCOL) return false;
  if (e.dir !== "down" && e.dir !== "up") return false;
  if (e.token !== undefined && typeof e.token !== "string") return false;
  const m = e.msg;
  if (typeof m !== "object" || m === null) return false;
  return typeof (m as Record<string, unknown>).kind === "string";
}
