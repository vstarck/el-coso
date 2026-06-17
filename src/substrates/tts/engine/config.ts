// tts substrate config. All paces are in base ticks (the host's mult-1
// baseline is 60 ticks/sec), so they are tunables of the substrate, not of
// the lens.
export type TtsConfig = {
  id: string;
  W: number;
  H: number;
  // Ticks per gravity row at normal fall. 30 ≈ 0.5 s/row at 60 Hz.
  gravity_period: number;
  // Ticks between horizontal steps while a direction is held (auto-repeat).
  move_period: number;
  // Cleared-lines win target. 0 = endless (the only outcome is topping out).
  win_lines: number;
};
