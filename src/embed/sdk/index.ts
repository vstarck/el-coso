/* ElCoso Embed SDK — public host-side entry (spec/25).
 *
 * ESM consumers (a bundler'd SPA): `import { createConductor } from ".../sdk"`.
 * Plain-<script> hosts: this module also attaches `window.ElCoso.createConductor`
 * as a side effect, so a non-bundler page can use it too.
 *
 * Only the HOST half is exported here. The guest runtime ships as the built
 * embed.html page, never imported by a host. */

import { createConductor } from "./conductor";

export { createConductor };
export type {
  Conductor,
  ConductorOptions,
  EmbedSpec,
  EmbedRemote,
  EmbedEvent,
} from "./conductor";
export { COSO_PROTOCOL } from "./protocol";
export type { DownMessage, UpMessage, Envelope, TunableManifest } from "./protocol";

if (typeof window !== "undefined") {
  const w = window as unknown as { ElCoso?: { createConductor: typeof createConductor } };
  w.ElCoso = { ...(w.ElCoso ?? {}), createConductor };
}
