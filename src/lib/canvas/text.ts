/* Canvas text helpers shared by in-canvas documentation surfaces (the
 * Manual-lens pattern). Extracted from the
 * first manual-lens consumer when pentris became the second. */

// Word-wrap `text` to `maxWidth` at the context's current font. Honors
// explicit newlines (each becomes a hard break).
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let cur = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const trial = `${cur} ${words[i]}`;
      if (ctx.measureText(trial).width > maxWidth) {
        lines.push(cur);
        cur = words[i]!;
      } else {
        cur = trial;
      }
    }
    lines.push(cur);
  }
  return lines;
}
