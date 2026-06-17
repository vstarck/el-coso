/* Synchronous thumbnail capture against the live session. Composes
 * historyStateAt + lens.renderThumbnail + canvas.toDataURL, then
 * re-anchors the substrate to the active branch's head before returning.
 *
 * Cached by chrome commit id (e.g. "c-3"). Stale entries from deleted
 * commits linger; clearThumbnailCache() purges. Cache bumps to a string
 * data URL — not an ImageBitmap — so callers can drop it directly into a
 * <div style={{ backgroundImage: `url(...)` }}> without async glue.
 */

import {
  historyActiveBranch,
  historyStateAt,
} from "../../history";
import { session } from "../session";

// Cache key includes dimensions so the same commit at two sizes doesn't
// collide. Most callers use defaults, so collisions are rare in practice.
const cache = new Map<string, string>();

const DEFAULT_THUMB_WIDTH = 384;
const DEFAULT_THUMB_HEIGHT = 216;

function cacheKey(commitId: string, w: number, h: number): string {
  return `${commitId}@${w}x${h}`;
}

export type CommitRef = {
  branchId: string;
  tick: number;
};

export function captureThumbnail(
  commitId: string,
  ref: CommitRef,
  opts?: { width?: number; height?: number },
): string | null {
  const width = opts?.width ?? DEFAULT_THUMB_WIDTH;
  const height = opts?.height ?? DEFAULT_THUMB_HEIGHT;
  const key = cacheKey(commitId, width, height);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const lens = session.mounted_lens;
  if (!lens) return null;
  // Spec/15: renderThumbnail is optional. Lenses whose vocabulary has no
  // natural Canvas 2D summary (ASCII, chart-shaped DOM) decline; the
  // chrome falls back to commitGlyph alone (cards / timeline render the
  // glyph instead of an image background).
  if (!lens.renderThumbnail) return null;

  try {
    const state = historyStateAt(session.history, ref.branchId, ref.tick);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    lens.renderThumbnail(state, canvas);
    const url = canvas.toDataURL("image/png");
    cache.set(key, url);
    return url;
  } catch (err) {
    // Defensive: a thumbnail crash must not tear down render. Most likely
    // cause is a stale-lens / fresh-state pairing across a substrate swap
    // (see setSubstrate). Log once per failure for visibility; callers
    // get null and fall back to commitGlyph.
    console.error("[thumbnail] renderThumbnail failed", err);
    return null;
  } finally {
    // Re-anchor: leave the substrate where the live render loop expects
    // it. Required even on the catch path so the live canvas doesn't
    // freeze at the scrub state. Cheap because the active head is
    // usually the destination of the most recent keyframe.
    const active = historyActiveBranch(session.history);
    historyStateAt(session.history, active.id, active.head_tick);
  }
}

export function clearThumbnailCache(): void {
  cache.clear();
}
