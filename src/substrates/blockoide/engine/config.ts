// Blockoide substrate config. Paces are in base ticks (the host's mult-1
// baseline is 60 ticks/sec), so they are tunables of the substrate, not of
// the lens.
export type BlockoideConfig = {
  id: string;
  W: number; // cross-section width
  D: number; // cross-section depth
  H: number; // well height
  // Ticks per gravity step at normal fall. 48 ≈ 0.8 s/step at 60 Hz.
  gravity_period: number;
  // Gravity accumulator gain while soft drop is held (1 = no boost).
  soft_factor: number;
  // Ticks between plane steps while a direction is held (auto-repeat).
  move_period: number;
  // Cleared-layers win target. 0 = endless (the only outcome is topping out).
  win_layers: number;
  // Authored permanent obstacles — flat `cells` indices set to WALL at
  // init. Empty for a clean well.
  walls: number[];
};
