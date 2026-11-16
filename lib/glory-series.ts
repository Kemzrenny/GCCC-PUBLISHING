import "server-only";
import type { Manual } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { gloryConfig } from "@/lib/glory-config";
import { getSetting, setSetting, markSheetDirty } from "@/lib/settings";
import { manualCode, monthKey, shortDay, teamFor, type Team } from "@/lib/glory";
import { reschedule, type Later, type Reschedule, type SeriesPart } from "@/lib/glory-plan";

// The parts made from one message, and what happens to the calendar when their number
// changes (the rule itself is in lib/glory-plan.ts).

export const defaultWriters = (team: Team | null) => ({
  membersWriter: team?.members[0]?.name ?? null,
  guideWriter: team?.members[1]?.name ?? team?.members[0]?.name ?? null,
});

// A part can still move while it's only planned or being written.
const movable = (m: Pick<Manual, "stage">) => m.stage === "PLANNED" || m.stage === "WRITING";
const removable = (m: Manual) => m.stage === "PLANNED" && !m.membersEditedAt && !m.guideEditedAt;

export async function seriesOf(m: Manual): Promise<Manual[]> {
  if (m.seriesId) return prisma.manual.findMany({ where: { seriesId: m.seriesId }, orderBy: [{ part: "asc" }, { saturday: "asc" }] });
  if (m.messageId && m.parts && m.parts > 1 && m.saturday) {
    const near = await prisma.manual.findMany({
      where: { messageId: m.messageId, parts: m.parts, saturday: { not: null } },
      orderBy: [{ part: "asc" }, { saturday: "asc" }],
    });
    // Parts of one series sit within a few months of each other.
    return near.filter((x) => Math.abs(x.saturday!.getTime() - m.saturday!.getTime()) < 200 * 86_400_000);
  }
  return [m];
}

async function laterThan(after: Date, exclude: string[]): Promise<(Later & { stage: string })[]> {
  const rows = await prisma.manual.findMany({
    where: { saturday: { gt: after }, id: { notIn: exclude } },
    select: { id: true, saturday: true, number: true, stage: true },
    orderBy: { saturday: "asc" },
  });
  return rows.map((r) => ({ id: r.id, saturday: r.saturday!, number: r.number, movable: movable(r), stage: r.stage }));
}

const label = (n: number | null, title?: string | null) => [manualCode(n), title ? `“${title}”` : null].filter(Boolean).join(" ") || "A manual";

export function describe(r: Reschedule, titles: Map<string, { number: number | null; title: string | null }>): string {
  const bits: string[] = [];
  if (r.add.length) bits.push(`Added ${r.add.map((a) => `part ${a.part} on ${shortDay(a.saturday)}${a.number ? ` (${manualCode(a.number)})` : ""}`).join(", ")}.`);
  if (r.remove.length) bits.push(`Took off ${r.remove.length} part${r.remove.length === 1 ? "" : "s"}.`);
  const moved = r.moves.filter((mv) => mv.from.getTime() !== mv.to.getTime());
  if (moved.length) {
    const dir = moved[0].to > moved[0].from ? "back" : "forward";
    bits.push(
      `Moved ${dir}: ${moved
        .map((mv) => {
          const t = titles.get(mv.id);
          return `${label(mv.oldNumber, t?.title)} to ${shortDay(mv.to)}${mv.number !== mv.oldNumber && mv.number ? ` as ${manualCode(mv.number)}` : ""}`;
        })
        .join("; ")}.`,
    );
  }
  return bits.join(" ");
}

export type LogEntry = { at: string; by: string; text: string; manualId?: string };

export async function logChange(entry: Omit<LogEntry, "at">) {
  let log: LogEntry[] = [];
  try {
    log = JSON.parse(await getSetting("gloryLog"));
  } catch {}
  log.unshift({ ...entry, at: new Date().toISOString() });
  await setSetting("gloryLog", JSON.stringify(log.slice(0, 20)));
}

export async function readLog(): Promise<LogEntry[]> {
  try {
    return JSON.parse(await getSetting("gloryLog"));
  } catch {
    return [];
  }
}

// What changing to `total` parts would do, without doing it.
export async function previewParts(manualId: string, total: number) {
  const m = await prisma.manual.findUniqueOrThrow({ where: { id: manualId } });
  const series = await seriesOf(m);
  return planFor(series, total);
}

async function planFor(series: Manual[], total: number) {
  const parts: SeriesPart[] = series
    .filter((p) => p.saturday)
    .map((p, i) => ({ id: p.id, part: p.part ?? i + 1, saturday: p.saturday!, number: p.number, removable: removable(p) }));
  if (!parts.length) return { plan: { add: [], remove: [], moves: [], error: "Give it a Saturday first." } as Reschedule, later: [] };
  const last = parts.reduce((a, b) => (b.saturday > a.saturday ? b : a)).saturday;
  const first = parts.reduce((a, b) => (b.saturday < a.saturday ? b : a)).saturday;
  // When shrinking, the parts being removed are part of the slots that come free.
  const later = await laterThan(total < parts.length ? first : last, series.map((p) => p.id));
  return { plan: reschedule(parts, total, later), later };
}

// Sets how many manuals a message makes and moves the calendar to match. Returns a note of
// what moved, which is also kept in the Glory Home log.
export async function changeParts(manualId: string, total: number, by: string): Promise<{ note: string; moved: { id: string; number: number | null; saturday: Date | null }[] }> {
  const m = await prisma.manual.findUniqueOrThrow({ where: { id: manualId } });
  const series = await seriesOf(m);
  const root = series[0];
  const { plan } = await planFor(series, total);
  if (plan.error) throw new Error(plan.error);
  const { teams, rotation } = await gloryConfig();
  const before = await prisma.manual.findMany({ where: { id: { in: plan.moves.map((mv) => mv.id) } } });
  const byId = new Map(before.map((b) => [b.id, b]));
  const writers = { membersWriter: root.membersWriter, guideWriter: root.guideWriter };

  await prisma.$transaction(async (tx) => {
    if (plan.remove.length) await tx.manual.deleteMany({ where: { id: { in: plan.remove } } });
    const keep = series.filter((p) => !plan.remove.includes(p.id));
    for (const [i, p] of keep.entries()) {
      await tx.manual.update({
        where: { id: p.id },
        data: { seriesId: root.id, part: total > 1 ? (p.part ?? i + 1) : null, parts: total > 1 ? total : null, partsConfirmed: true },
      });
    }
    for (const a of plan.add) {
      await tx.manual.create({
        data: {
          messageId: root.messageId,
          seriesId: root.id,
          number: a.number,
          code: manualCode(a.number),
          saturday: a.saturday,
          stage: "PLANNED",
          part: a.part,
          parts: total,
          partsConfirmed: true,
          ...writers,
          source: "portal",
        },
      });
    }
    for (const mv of plan.moves) {
      const old = byId.get(mv.id)!;
      // Moving into a month another team writes: if it still had the old team's default
      // writers, it gets the new team's.
      const fromTeam = teamFor(monthKey(mv.from), teams, rotation);
      const toTeam = teamFor(monthKey(mv.to), teams, rotation);
      const oldDefaults = defaultWriters(fromTeam);
      const swap = fromTeam?.id !== toTeam?.id && old.membersWriter === oldDefaults.membersWriter && old.guideWriter === oldDefaults.guideWriter;
      await tx.manual.update({
        where: { id: mv.id },
        data: { saturday: mv.to, number: mv.number, code: manualCode(mv.number), ...(swap ? defaultWriters(toTeam) : {}) },
      });
    }
  });

  const titles = new Map(before.map((b) => [b.id, { number: b.number, title: b.title }]));
  const note = describe(plan, titles);
  const source = await prisma.message.findUnique({ where: { id: root.messageId ?? "" }, select: { title: true } });
  if (note) await logChange({ by, text: `${source?.title ?? "A message"} now makes ${total} manual${total === 1 ? "" : "s"}. ${note}`, manualId: root.id });
  await markSheetDirty();
  return { note, moved: plan.moves.map((mv) => ({ id: mv.id, number: byId.get(mv.id)?.number ?? null, saturday: byId.get(mv.id)?.saturday ?? null })) };
}

// For the plan panel: where the parts would go if a message were planned on a Saturday.
export async function previewNew(saturday: Date, number: number, total: number) {
  if (total <= 1) return { plan: { add: [], remove: [], moves: [] } as Reschedule, titles: new Map() };
  const later = await laterThan(saturday, []);
  const plan = reschedule([{ id: "new", part: 1, saturday, number, removable: false }], total, later);
  const rows = await prisma.manual.findMany({ where: { id: { in: plan.moves.map((m) => m.id) } }, select: { id: true, number: true, title: true } });
  return { plan, titles: new Map(rows.map((r) => [r.id, { number: r.number, title: r.title }])) };
}
