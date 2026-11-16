// When the writers change how many manuals a message makes, the Saturdays after it move.
// Kept free of the database so it can be tested.
//
// Growing from 1 to 3 parts puts parts 2 and 3 on the Saturdays straight after the last
// part, and every later manual that can still move (planned or being written) goes back by
// two Saturdays, keeping any gaps. Manuals already reviewed, sent or taught stay where they
// are, and the others flow around them. Shrinking takes the extra parts off and, when that
// leaves the next Saturdays empty, brings the later manuals forward again. Manual numbers
// follow the new order.

const WEEK = 7 * 86_400_000;

export type SeriesPart = { id: string; part: number; saturday: Date; number: number | null; removable: boolean };
export type Later = { id: string; saturday: Date; number: number | null; movable: boolean };
export type Move = { id: string; from: Date; to: Date; number: number | null; oldNumber: number | null };
export type Reschedule = {
  add: { part: number; saturday: Date; number: number | null }[];
  remove: string[];
  moves: Move[];
  error?: string;
};

const t = (d: Date) => d.getTime();

// Saturdays after `after` that no fixed manual holds, as many as needed.
function slotsAfter(after: Date, fixed: Set<number>, count: number): Date[] {
  const out: Date[] = [];
  for (let d = new Date(t(after) + WEEK); out.length < count; d = new Date(t(d) + WEEK)) if (!fixed.has(t(d))) out.push(d);
  return out;
}

export function reschedule(series: SeriesPart[], total: number, later: Later[]): Reschedule {
  const parts = [...series].sort((a, b) => a.part - b.part);
  const none: Reschedule = { add: [], remove: [], moves: [] };
  if (!parts.length || total < 1) return { ...none, error: "Nothing to change." };
  const current = parts.length;
  if (total === current) return none;

  const fixed = later.filter((m) => !m.movable);
  const fixedDays = new Set(fixed.map((m) => t(m.saturday)));
  const fixedNumbers = new Set(fixed.map((m) => m.number).filter((n): n is number => n !== null));
  const movable = later.filter((m) => m.movable).sort((a, b) => t(a.saturday) - t(b.saturday));

  let remove: string[] = [];
  let kept = parts;
  if (total < current) {
    const extra = parts.filter((p) => p.part > total);
    const stuck = extra.find((p) => !p.removable);
    if (stuck) return { ...none, error: `Part ${stuck.part} has already been started, so it can't be taken off. Change it on its own page if it's no longer needed.` };
    remove = extra.map((p) => p.id);
    kept = parts.filter((p) => p.part <= total);
  }
  const last = kept.reduce((a, b) => (t(b.saturday) > t(a.saturday) ? b : a));
  // Where the shift starts: after the last part that stays. When shrinking, the removed
  // parts' Saturdays sit in the slots and are free.
  const start = last.saturday;
  const occupied = movable.filter((m) => t(m.saturday) > t(start));
  const horizon = occupied.length ? t(occupied[occupied.length - 1].saturday) : t(start);
  const needed = Math.max(0, Math.round((horizon - t(start)) / WEEK)) + Math.abs(total - current) + 2;
  const slots = slotsAfter(start, fixedDays, needed);
  const index = new Map(slots.map((d, i) => [t(d), i]));

  const add: Reschedule["add"] = [];
  let shift = 0;
  if (total > current) {
    shift = total - current;
    for (let i = 0; i < shift; i++) add.push({ part: current + 1 + i, saturday: slots[i], number: null });
  } else {
    // Bring later manuals forward only when the freed Saturdays come straight after.
    const k = current - total;
    const freeAhead = slots.slice(0, k).every((d) => !occupied.some((m) => t(m.saturday) === t(d)));
    shift = freeAhead ? -k : 0;
  }

  const placed = occupied.map((m) => {
    const i = index.get(t(m.saturday)) ?? 0;
    let to = slots[i + shift];
    if (!to) to = slotsAfter(slots[slots.length - 1], fixedDays, i + shift - slots.length + 1).pop()!;
    return { m, to, number: m.number };
  });

  // Numbers follow the new order, after the last part that stays.
  let next = last.number;
  const ordered = [
    ...add.map((a) => ({ at: t(a.saturday), set: (n: number) => (a.number = n), skip: false })),
    ...placed.map((p) => ({ at: t(p.to), set: (n: number) => (p.number = n), skip: p.m.number === null })),
  ].sort((a, b) => a.at - b.at);
  if (next !== null) {
    for (const item of ordered) {
      if (item.skip) continue;
      do next++;
      while (fixedNumbers.has(next));
      item.set(next);
    }
  }

  const moves: Move[] = placed
    .map((p) => ({ id: p.m.id, from: p.m.saturday, to: p.to, number: p.number, oldNumber: p.m.number }))
    .filter((mv) => t(mv.from) !== t(mv.to) || mv.number !== mv.oldNumber);
  return { add, remove, moves };
}
