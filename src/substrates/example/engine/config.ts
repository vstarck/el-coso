// Example substrate config. Minimal shape — `id` + grid dimensions.
//
// Real substrates typically group tunables into domain sub-configs
// (e.g. `grid` / `spawn` / `win` fields). See
// `src/substrates/conway/engine/config.ts` for a worked instance.
export type ExampleConfig = {
  id: string;
  W: number;
  H: number;
};
