/* Host resources for the app's histories (engine/types.ts, *host resources*).
 *
 * The session builds a history at import time and on every substrate switch, synchronously; acquiring some resources
 * is not (a GPU device). So the HOST acquires them and sets them here, and each history reads them WHEN IT IS BUILT.
 * A host may set them before importing the app (when the first substrate needs them) or later (a history built
 * meanwhile does not need them, or is refused with the reason in `unavailable`). Changing them never touches a
 * history already built: it keeps the resources it was allocated with.
 *
 * A host that sets nothing leaves them empty, and a bundle that `requires` one is refused by allocSubstrate — the
 * refusal, with its reason, is the behaviour; there is no degraded run.
 */
import type { EngineResources } from "@/engine/types";

let resources: EngineResources = {};

export function setEngineResources(r: EngineResources): void {
  resources = r;
}

/** Read by the session each time it builds a history. */
export function engineResources(): EngineResources {
  return resources;
}
