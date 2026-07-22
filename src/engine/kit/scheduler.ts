// A coordinate-time scheduler + mailbox for substrates that each own a clock.
//
// Substrate-neutral machinery: coordinate N substrates, each advancing at its OWN
// tick rate (its proper time), under one coordinate-time schedule, coupled only
// through mailboxes. The concrete resolution of the sim-engine model (fields are
// driven, SUBSTRATES own a clock, coordination is this scheduler) — see the design
// essay `context/essays/composition/simulation-engines.md` §7 (in the private tree).
//
// Extracted to the kit (extract-don't-design) once a second consumer appeared:
//   1. cronos   — the proto prototype (carrots × rabbits).
//   2. tierra   — the layered ecosystem substrate (drivers/fields/flora/fauna/decomposers).
// The move was pure: cronos's original locks are the regression for this file.
//
// The whole model rests on one primitive: OWNS A CLOCK.
//   - a `field` owns no rate — it ticks when its host substrate says so. NOT Schedulable.
//   - a `substrate` owns a rate — it decides when to advance, and may drive fields.
//     It IS Schedulable, and the scheduler advances it on its own period.

// A substrate that owns a clock. `tick()` advances its proper time by one step:
// drain its inbox, evolve its own state, deposit into peers' mailboxes — then commit.
export type Schedulable = {
  readonly id: string;
  readonly period: number; // coordinate-time between this substrate's ticks (dt of its proper time)
  readonly priority: number; // authored order at coincident ticks — unique per scheduler (enforced)
  tick(): void;
};

export type Scheduler = {
  now(): number; // current coordinate time
  ticks(id: string): number; // how many times a substrate has ticked (its proper-time count)
  run(until: number): void; // advance coordinate time toward `until`, ticking each substrate on its own period
};

// A mailbox: peers DEPOSIT messages across the clock gap; the owner DRAINS on its
// OWN tick and folds them. The fold is the owner's choice and carries the coupling
// semantics:
//   - a divisible flux  → SUM the deposits (grazing a fraction, energy transfer).
//   - an exclusive claim → ARBITRATE (one winner per contested unit; the rest whiff).
// The mailbox itself is just an ordered queue; deposit order is deterministic because
// the scheduler runs substrates sequentially (logical concurrency, never threads).
export type Mailbox<M> = {
  deposit(m: M): void;
  drain(): M[];
  pending(): number;
};

export function makeMailbox<M>(): Mailbox<M> {
  let q: M[] = [];
  return {
    deposit: (m) => {
      q.push(m);
    },
    drain: () => {
      const out = q;
      q = [];
      return out;
    },
    pending: () => q.length,
  };
}

// The coordinate-time scheduler. Determinism: a total order on (due, priority) with
// no wall-clock and sequential execution ⇒ same inputs → identical trajectory. The
// order at coincidences is FULLY AUTHORED: priorities must be unique — an id/slot
// fallback would let a naming accident decide who observes whom, so it is refused at
// construction rather than silently resolved. A due time is recomputed as
// `tickCount × period` (not accumulated) so it can't drift. A linear min-scan is fine
// for a handful of substrates.
export function makeScheduler(subs: Schedulable[]): Scheduler {
  if (subs.length === 0) throw new Error("scheduler: needs at least one Schedulable");
  const seen = new Set<string>();
  const seenPriority = new Map<number, string>();
  for (const s of subs) {
    if (!(s.period > 0)) throw new Error(`scheduler: ${s.id} period=${s.period} must be > 0`);
    if (seen.has(s.id)) throw new Error(`scheduler: duplicate substrate id ${s.id}`);
    seen.add(s.id);
    const holder = seenPriority.get(s.priority);
    if (holder !== undefined) {
      throw new Error(
        `scheduler: ${s.id} and ${holder} share priority ${s.priority} — the order at ` +
          `coincident ticks must be authored, not inherited from ids`,
      );
    }
    seenPriority.set(s.priority, s.id);
  }
  const count = new Map<string, number>(subs.map((s) => [s.id, 0]));
  let t = 0;

  const due = (s: Schedulable): number => count.get(s.id)! * s.period;

  return {
    now: () => t,
    ticks: (id) => {
      const c = count.get(id);
      if (c === undefined) throw new Error(`scheduler: unknown substrate ${id}`);
      return c;
    },
    run: (until) => {
      for (;;) {
        // earliest due substrate; coincidences resolved by authored priority (unique
        // by construction, so this is a total order).
        let next: Schedulable | null = null;
        let nextDue = Infinity;
        for (const s of subs) {
          const d = due(s);
          if (next === null || d < nextDue || (d === nextDue && s.priority < next.priority)) {
            next = s;
            nextDue = d;
          }
        }
        // stop strictly before `until` — a tick due exactly at `until` belongs to the next run.
        if (next === null || nextDue >= until) {
          t = until;
          return;
        }
        t = nextDue;
        next.tick();
        count.set(next.id, count.get(next.id)! + 1);
      }
    },
  };
}
