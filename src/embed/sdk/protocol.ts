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

// A tunable as advertised to the host at mount (subset of the lens's LensTunable).
export type TunableManifest = {
  path: string[];
  label: string;
  group?: string;
  type: "float" | "int" | "bool" | "enum";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
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
    }
  | { kind: "state"; playing: boolean; tick?: number }
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
