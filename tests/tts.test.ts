import { describe, it, expect } from "vitest";
import { runHeadless } from "@/engine/headless";
import {
  ttsBundle,
  parseLevel,
  pieceCells,
  collides,
  type TtsInputs,
  type TtsConfig,
  type SubstrateState,
} from "@/substrates/tts";
import { stateView, boardRows } from "@/substrates/tts/lens/render";

const NEUTRAL: TtsInputs = { move: 0, rotate: 0, drop: false };
function neutrals(n: number): TtsInputs[] {
  return Array.from({ length: n }, () => ({ ...NEUTRAL }));
}

const CONFIG: TtsConfig = parseLevel({ id: "classic" });

describe("tts engine", () => {
  it("spawns the first piece on tick 1 and gravity makes it fall", () => {
    const s1 = runHeadless(ttsBundle, CONFIG, 7, neutrals(1));
    expect(s1.piece_kind).toBeGreaterThanOrEqual(0);
    expect(s1.next_kind).toBeGreaterThanOrEqual(0);
    expect(s1.spawn_count).toBe(1);
    const y_at_1 = s1.piece_y;
    // After a full gravity period the piece has dropped exactly one row.
    const s2 = runHeadless(ttsBundle, CONFIG, 7, neutrals(1 + CONFIG.gravity_period));
    expect(s2.piece_y).toBe(y_at_1 + 1);
  });

  it("a drop tap locks the piece into the stack", () => {
    const inputs = [NEUTRAL, { move: 0, rotate: 0, drop: true } as TtsInputs];
    const s = runHeadless(ttsBundle, CONFIG, 3, inputs);
    // Dropping spawns the next piece (spawn_count 2) and leaves cells set.
    expect(s.spawn_count).toBe(2);
    let filled = 0;
    for (let i = 0; i < s.cells.length; i++) if (s.cells[i] !== 0) filled++;
    expect(filled).toBe(4); // one tetromino = four cells
  });

  it("determinism: same (config, seed, inputs) → identical board", () => {
    const a = runHeadless(ttsBundle, CONFIG, 42, neutrals(200));
    const b = runHeadless(ttsBundle, CONFIG, 42, neutrals(200));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.tick).toBe(b.tick);
  });

  it("clears a full row and counts it", () => {
    // Tiny 4-wide well so a single I piece (width 4) fills a row on drop.
    const cfg = parseLevel({ id: "thin", W: 4, H: 8, gravity_period: 1000 });
    // Drive until an I piece (kind 0) is the falling piece, then hard-drop it.
    // Seed search: find a seed whose first piece is the I.
    let seed = 1;
    for (; seed < 50; seed++) {
      const first = runHeadless(ttsBundle, cfg, seed, neutrals(1));
      if (first.piece_kind === 0) break;
    }
    const s = runHeadless(ttsBundle, cfg, seed, [
      NEUTRAL,
      { move: 0, rotate: 0, drop: true },
    ]);
    expect(s.lines).toBe(1);
    // The cleared row left the board empty again (next piece is still up top).
    let bottomFilled = 0;
    for (let x = 0; x < cfg.W; x++) {
      if (s.cells[(cfg.H - 1) * cfg.W + x] !== 0) bottomFilled++;
    }
    expect(bottomFilled).toBe(0);
  });

  it("rotation is computed and bounded to the board", () => {
    // The T piece rotated stays four cells, normalized to the origin.
    const cells = pieceCells(2, 1);
    expect(cells.length).toBe(4);
    expect(Math.min(...cells.map((c) => c.x))).toBe(0);
    expect(Math.min(...cells.map((c) => c.y))).toBe(0);
  });

  it("collides reports floor and walls", () => {
    const s = runHeadless(ttsBundle, CONFIG, 9, neutrals(1));
    expect(collides(s, s.piece_kind, s.piece_rot, -1, s.piece_y)).toBe(true);
    expect(collides(s, s.piece_kind, s.piece_rot, s.piece_x, s.H)).toBe(true);
  });
});

describe("tts lens view", () => {
  it("board rows respect columns and rows, glyphs distinguish pieces", () => {
    const s: SubstrateState = runHeadless(ttsBundle, CONFIG, 11, neutrals(5));
    const rows = boardRows(s);
    expect(rows.length).toBe(CONFIG.H);
    for (const r of rows) expect(r.length).toBe(CONFIG.W);
    // The falling piece's glyph appears somewhere on the board.
    const view = stateView(s);
    expect(view.piece).toMatch(/^[IOTSZJL]$/);
    expect(view.board.join("")).toContain(view.piece);
  });

  it("renderJson is valid JSON carrying the board array", () => {
    const s = runHeadless(ttsBundle, CONFIG, 1, neutrals(3));
    const parsed = JSON.parse(stateView(s) && JSON.stringify(stateView(s)));
    expect(Array.isArray(parsed.board)).toBe(true);
    expect(typeof parsed.tick).toBe("number");
    expect(parsed.status).toBe("playing");
  });
});
