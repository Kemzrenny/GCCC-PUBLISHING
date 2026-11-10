import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { gloryConfig } from "@/lib/glory-config";
import { addMonths, monthKey, nextStep, saturdaysIn, shortDay, teamFor, manualCode, type Stage, type Tone } from "@/lib/glory";

const DAY = 86_400_000;

// A message chosen for a month's team, not given a Saturday or number yet.
export const LINED_UP: Prisma.ManualWhereInput = { saturday: null, number: null, stage: "PLANNED" };

export const manualInclude = {
  message: { select: { id: true, title: true, date: true, speaker: true, status: true } },
} satisfies Prisma.ManualInclude;

export type ManualWithMessage = Prisma.ManualGetPayload<{ include: typeof manualInclude }>;

// Today's date in Lagos, as a UTC midnight.
export function lagosToday(now = new Date()): Date {
  const t = new Date(now.getTime() + 3_600_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

export type WeekItem = { tone: Tone; title: string; detail: string; manualId?: string; plan?: string };

export async function monthView(key: string) {
  const saturdays = saturdaysIn(key);
  const { teams, rotation } = await gloryConfig();
  const team = teamFor(key, teams, rotation);
  const nextTeam = teamFor(addMonths(key, 1), teams, rotation);
  const first = saturdays[0];
  const last = saturdays[saturdays.length - 1];
  const manuals = await prisma.manual.findMany({
    where: { saturday: { gte: first, lte: last } },
    include: manualInclude,
    orderBy: { saturday: "asc" },
  });
  const weeks = saturdays.map((d) => ({ saturday: d, manual: manuals.find((m) => m.saturday?.getTime() === d.getTime()) ?? null }));
  return { key, team, nextTeam, weeks };
}

// What needs doing over the next three weeks, whatever month is on screen.
export async function thisWeek(now = new Date()): Promise<WeekItem[]> {
  const today = lagosToday(now);
  const soon = await prisma.manual.findMany({
    where: { saturday: { gte: new Date(today.getTime() - 14 * DAY), lte: new Date(today.getTime() + 21 * DAY) } },
    orderBy: { saturday: "asc" },
  });
  const items: (WeekItem & { at: number })[] = [];
  for (const m of soon) {
    const sat = m.saturday!;
    const label = [manualCode(m.number), m.title].filter(Boolean).join(" · ") || "The manual";
    if (sat.getTime() < today.getTime()) {
      if (m.stage !== "TAUGHT") items.push({ at: sat.getTime(), tone: "soon", title: `${shortDay(sat)}: was ${label} taught?`, detail: "Mark it taught, or move it to another Saturday.", manualId: m.id });
      continue;
    }
    if (m.stage === "TAUGHT") continue;
    const step = nextStep(m.stage as Stage, sat, now);
    items.push({ at: sat.getTime(), tone: step.tone, title: `${shortDay(sat)}: ${label}`, detail: step.label.replace(/^Next: /, "Next: "), manualId: m.id });
  }
  const taken = new Set(soon.map((m) => m.saturday!.getTime()));
  for (let d = new Date(today.getTime() + ((6 - today.getUTCDay() + 7) % 7) * DAY); d.getTime() <= today.getTime() + 21 * DAY; d = new Date(d.getTime() + 7 * DAY)) {
    if (taken.has(d.getTime())) continue;
    const days = Math.round((d.getTime() - today.getTime()) / DAY);
    items.push({ at: d.getTime(), tone: days <= 10 ? "late" : "soon", title: `${shortDay(d)} has no manual`, detail: days <= 10 ? "Plan it now so there’s time to write and review." : "Plan it soon.", plan: d.toISOString().slice(0, 10) });
  }
  return items.sort((a, b) => a.at - b.at).map(({ at, ...rest }) => (void at, rest));
}

// Messages lined up for a month (no Saturday yet): this month's and next month's, plus any
// left over from earlier months.
export async function linedUp(key: string) {
  const next = addMonths(key, 1);
  const rows = await prisma.manual.findMany({
    where: { ...LINED_UP, plannedMonth: { lte: next } },
    include: manualInclude,
    orderBy: [{ plannedMonth: "desc" }, { createdAt: "asc" }],
    take: 30,
  });
  return rows;
}

export function currentMonth(now = new Date()) {
  return monthKey(lagosToday(now));
}

// ---- All manuals ----

export const MANUALS_PER_PAGE = 30;
export type ManualFilter = { show: "all" | "message" | "docs" | "lined"; year: string; writer: string; q: string; page: number };

export function manualWhere(f: ManualFilter): Prisma.ManualWhereInput {
  const and: Prisma.ManualWhereInput[] = [];
  if (f.show === "lined") and.push(LINED_UP);
  else and.push({ NOT: LINED_UP });
  if (f.show === "message") and.push({ messageId: null });
  // Either document isn't in the Glory Home folder yet (even if an older copy is linked).
  if (f.show === "docs") and.push({ OR: [{ membersDocId: null }, { guideDocId: null }] });
  if (/^\d{4}$/.test(f.year)) {
    const y = Number(f.year);
    and.push({ saturday: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) } });
  }
  if (f.writer) and.push({ OR: [{ membersWriter: f.writer }, { guideWriter: f.writer }] });
  if (f.q) {
    for (const w of f.q.trim().split(/\s+/).slice(0, 5)) {
      const n = Number(w);
      and.push({
        OR: [
          { title: { contains: w, mode: "insensitive" } },
          { sourceTitle: { contains: w, mode: "insensitive" } },
          { message: { title: { contains: w, mode: "insensitive" } } },
          ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
        ],
      });
    }
  }
  return { AND: and };
}

export async function manualList(f: ManualFilter) {
  const where = manualWhere(f);
  const [rows, total, counts, writers, years] = await Promise.all([
    prisma.manual.findMany({
      where,
      include: manualInclude,
      orderBy: f.show === "lined" ? [{ plannedMonth: { sort: "desc", nulls: "last" } }] : [{ saturday: { sort: "desc", nulls: "last" } }, { number: { sort: "desc", nulls: "last" } }],
      skip: (f.page - 1) * MANUALS_PER_PAGE,
      take: MANUALS_PER_PAGE,
    }),
    prisma.manual.count({ where }),
    Promise.all([
      prisma.manual.count({ where: manualWhere({ ...f, show: "all", page: 1 }) }),
      prisma.manual.count({ where: manualWhere({ ...f, show: "message", page: 1 }) }),
      prisma.manual.count({ where: manualWhere({ ...f, show: "docs", page: 1 }) }),
      prisma.manual.count({ where: manualWhere({ ...f, show: "lined", page: 1 }) }),
    ]),
    prisma.$queryRaw<{ w: string }[]>`SELECT DISTINCT w FROM (SELECT "membersWriter" AS w FROM "Manual" UNION SELECT "guideWriter" FROM "Manual") x WHERE w IS NOT NULL ORDER BY w`,
    prisma.$queryRaw<{ y: number }[]>`SELECT DISTINCT EXTRACT(YEAR FROM "saturday")::int AS y FROM "Manual" WHERE "saturday" IS NOT NULL ORDER BY y DESC`,
  ]);
  return {
    rows,
    total,
    pages: Math.max(1, Math.ceil(total / MANUALS_PER_PAGE)),
    counts: { all: counts[0], message: counts[1], docs: counts[2], lined: counts[3] },
    writers: writers.map((w) => w.w),
    years: years.map((y) => y.y),
  };
}
