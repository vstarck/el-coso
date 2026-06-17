import type { ExampleConfig } from "./config";

// Authoring-flat JSON in, runtime config out. Reuse this exact shape
// when authoring real substrates; the validator is just `as` for the
// fields the runtime depends on with a defensive fallback.
export type LevelFile = {
  id: string;
  W?: number;
  H?: number;
};

export function parseLevel(json: unknown): ExampleConfig {
  const o = json as LevelFile;
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    W: typeof o.W === "number" ? o.W : 16,
    H: typeof o.H === "number" ? o.H : 12,
  };
}
