/* HTML backend — materialize a Surface into a <pre>.
 *
 * Full rewrite per call. Rows join with "\n"; within a row, maximal runs
 * of cells sharing identical style coalesce into one <span style>. A
 * bare-default run emits raw (escaped) text with no span. The output
 * carries no data-* attribute and no event listener — the purity rule
 * holds here, at the only place markup is produced.
 */

import type { Cell, Surface } from "./surface";

function escapeHtml(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else out += ch;
  }
  return out;
}

// A style signature: cells with equal signatures coalesce. Empty string
// means "no styling" → emitted as raw text.
function styleKey(c: Cell): string {
  if (!c.fg && !c.bg && !c.bold && !c.dim) return "";
  return `${c.fg ?? ""}|${c.bg ?? ""}|${c.bold ? "b" : ""}|${c.dim ? "d" : ""}`;
}

function styleAttr(c: Cell): string {
  const parts: string[] = [];
  if (c.fg) parts.push(`color:${c.fg}`);
  if (c.bg) parts.push(`background:${c.bg}`);
  if (c.bold) parts.push("font-weight:700");
  if (c.dim) parts.push("opacity:0.55");
  return parts.join(";");
}

export function renderToPre(s: Surface, pre: HTMLPreElement): void {
  const rows: string[] = [];
  for (let y = 0; y < s.h; y++) {
    let row = "";
    let runKey: string | null = null;
    let runText = "";
    let runStyle = "";

    const flush = (): void => {
      if (runText === "") return;
      const escaped = escapeHtml(runText);
      row += runKey === "" ? escaped : `<span style="${runStyle}">${escaped}</span>`;
      runText = "";
    };

    for (let x = 0; x < s.w; x++) {
      const cell = s.cells[y * s.w + x] ?? { glyph: " " };
      const key = styleKey(cell);
      if (key !== runKey) {
        flush();
        runKey = key;
        runStyle = key === "" ? "" : styleAttr(cell);
      }
      runText += cell.glyph;
    }
    flush();
    rows.push(row);
  }
  pre.innerHTML = rows.join("\n");
}
