/* Notices — messages the chrome must show a person, raised OUTSIDE React: the session builds its first history while
 * its module loads, before any component exists. Today one kind: a substrate the app could not open (its history
 * could not be built — e.g. allocSubstrate refused a bundle whose required host resource is absent). Before this, such
 * a refusal at boot threw out of the session's import and the app never rendered; on a switch it left the old
 * substrate with its lens detached and the error uncaught in a click handler.
 *
 * Every notice is also logged: a notice nobody looks at must still leave a trace. */

export type Notice = { id: number; title: string; body: string };

let notices: readonly Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export function pushNotice(title: string, body: string): void {
  notices = [...notices, { id: nextId++, title, body }];
  console.error(`[el-coso] ${title}: ${body}`);
  for (const l of listeners) l();
}

export function dismissNotice(id: number): void {
  notices = notices.filter((n) => n.id !== id);
  for (const l of listeners) l();
}

export function currentNotices(): readonly Notice[] {
  return notices;
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Try candidates in order and return the first that builds, with every refusal before it (its error kept). Pure:
 *  the session's boot uses it so a substrate that cannot open does not take the app down with it. */
export function firstBuildable<C, F>(candidates: readonly C[], build: (c: C) => F): { candidate: C; frame: F; refused: { candidate: C; error: unknown }[] } {
  const refused: { candidate: C; error: unknown }[] = [];
  for (const candidate of candidates) {
    try {
      return { candidate, frame: build(candidate), refused };
    } catch (error) {
      refused.push({ candidate, error });
    }
  }
  const why = refused.map((r) => (r.error instanceof Error ? r.error.message : String(r.error))).join(" · ");
  throw new Error(`no substrate could be opened (${refused.length} tried): ${why}`);
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
