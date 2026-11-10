import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDate, isoDay } from "@/lib/dates";

// Check dates: messages dated by the day they went up on Podbean, for someone to confirm
// or correct. Grouped by upload day (batches are easiest to fix together), or with the
// messages that matter most first.

export const TO_CHECK: Prisma.MessageWhereInput = { dateFromUpload: true, needsDetails: false };
export const GROUPS_PER_PAGE = 10;
const USED_PER_PAGE = 40;

export type CheckRow = { id: string; title: string; speaker: string | null; audioUrl: string | null; date: string; tags: string[] };
export type CheckGroup = { key: string; label: string; note: string; batch: boolean; rows: CheckRow[] };

const select = {
  id: true,
  title: true,
  speaker: true,
  audioUrl: true,
  date: true,
  status: true,
  _count: { select: { manuals: true } },
} satisfies Prisma.MessageSelect;

type Row = Prisma.MessageGetPayload<{ select: typeof select }>;

function toRow(m: Row): CheckRow {
  const tags: string[] = [];
  if (m.status === "APPROVED") tags.push("Approved");
  else if (m.status === "AI_DRAFT" || m.status === "IN_REVIEW") tags.push("Transcribed");
  if (m._count.manuals) tags.push(`In ${m._count.manuals} manual${m._count.manuals === 1 ? "" : "s"}`);
  return { id: m.id, title: m.title, speaker: m.speaker, audioUrl: m.audioUrl, date: isoDay(m.date), tags };
}

export async function checkDateCounts() {
  const [toCheck, checked] = await Promise.all([
    prisma.message.count({ where: TO_CHECK }),
    prisma.message.count({ where: { dateCheckedAt: { not: null } } }),
  ]);
  return { toCheck, checked };
}

export async function checkDateGroups(order: "day" | "used", page: number): Promise<{ groups: CheckGroup[]; pages: number }> {
  if (order === "used") {
    const total = await prisma.message.count({ where: TO_CHECK });
    const rows = await prisma.message.findMany({
      where: TO_CHECK,
      // Messages in manuals first, then approved, then transcribed, then newest.
      orderBy: [{ manuals: { _count: "desc" } }, { transcript: { approvedAt: { sort: "desc", nulls: "last" } } }, { status: "desc" }, { date: "desc" }],
      skip: (page - 1) * USED_PER_PAGE,
      take: USED_PER_PAGE,
      select,
    });
    const used = rows.filter((r) => r._count.manuals || r.status !== "NOT_STARTED");
    const rest = rows.filter((r) => !(r._count.manuals || r.status !== "NOT_STARTED"));
    const groups: CheckGroup[] = [];
    if (used.length)
      groups.push({ key: "used", label: "Transcribed or in a manual", note: "These are already being used, so their dates matter most.", batch: false, rows: used.map(toRow) });
    if (rest.length) groups.push({ key: "rest", label: "Not transcribed yet", note: "Newest first.", batch: false, rows: rest.map(toRow) });
    return { groups, pages: Math.max(1, Math.ceil(total / USED_PER_PAGE)) };
  }

  const days = await prisma.message.groupBy({ by: ["date"], where: TO_CHECK, _count: { _all: true }, orderBy: { date: "desc" } });
  const slice = days.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE).filter((d) => d.date);
  const rows = await prisma.message.findMany({
    where: { ...TO_CHECK, date: { in: slice.map((d) => d.date!) } },
    orderBy: [{ date: "desc" }, { title: "asc" }],
    select,
  });
  const groups = slice.map((d) => {
    const mine = rows.filter((r) => r.date?.getTime() === d.date!.getTime());
    const n = mine.length;
    const batch = n > 1;
    return {
      key: isoDay(d.date),
      label: `Uploaded ${formatDate(d.date)} · ${n} message${n === 1 ? "" : "s"}`,
      note: batch
        ? "Went up together, so probably not all preached that day. Change the ones you know."
        : "Uploaded on its own, so the date is probably close.",
      batch,
      rows: mine.map(toRow),
    };
  });
  return { groups, pages: Math.max(1, Math.ceil(days.length / GROUPS_PER_PAGE)) };
}
