import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TAB_STATUSES, TABS, type TabKey } from "@/lib/status";
import { getSetting } from "@/lib/settings";

export const PAGE_SIZE = 25;

export type LibraryQuery = { q?: string; tab?: string; speaker?: string; year?: string; page?: string };

export function readQuery(sp: Record<string, string | string[] | undefined>): Required<LibraryQuery> {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tab = one(sp.tab);
  return {
    q: one(sp.q).slice(0, 200),
    tab: TABS.some((t) => t.key === tab) ? tab : "all",
    speaker: one(sp.speaker),
    year: /^\d{4}$/.test(one(sp.year)) ? one(sp.year) : "",
    page: /^\d+$/.test(one(sp.page)) ? one(sp.page) : "1",
  };
}

function where(q: Required<LibraryQuery>): Prisma.MessageWhereInput {
  const and: Prisma.MessageWhereInput[] = [];
  if (q.q) {
    const words = q.q.trim().split(/\s+/).slice(0, 6);
    for (const w of words) {
      and.push({
        OR: [
          { title: { contains: w, mode: "insensitive" } },
          { series: { contains: w, mode: "insensitive" } },
          { speaker: { contains: w, mode: "insensitive" } },
          { summary: { contains: w, mode: "insensitive" } },
          { themes: { has: w } },
          { scriptures: { has: w } },
        ],
      });
    }
  }
  const tab = q.tab as TabKey;
  if (tab === "needs") and.push({ needsDetails: true });
  else if (tab !== "all") and.push({ status: { in: TAB_STATUSES[tab] } });
  if (q.speaker) and.push({ speaker: q.speaker });
  if (q.year) {
    const y = Number(q.year);
    and.push({ date: { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) } });
  }
  return and.length ? { AND: and } : {};
}

export async function libraryPage(q: Required<LibraryQuery>) {
  const page = Math.max(1, Number(q.page));
  const filter = where(q);
  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where: filter,
      orderBy: [{ date: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        date: true,
        speaker: true,
        series: true,
        location: true,
        status: true,
        needsDetails: true,
        assigneeName: true,
        dueLabel: true,
        assignee: { select: { name: true } },
        _count: { select: { manuals: true } },
      },
    }),
    prisma.message.count({ where: filter }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function libraryStats() {
  const [total, approved, inProgress, needsDetails, linkedManuals, manualsWritten, speakers, years] = await Promise.all([
    prisma.message.count(),
    prisma.message.count({ where: { status: "APPROVED" } }),
    prisma.message.count({ where: { status: { in: ["QUEUED", "TRANSCRIBING", "AI_DRAFT", "IN_REVIEW"] } } }),
    prisma.message.count({ where: { needsDetails: true } }),
    prisma.message.count({ where: { manuals: { some: {} } } }),
    getSetting("manualsWritten"),
    prisma.message.groupBy({ by: ["speaker"], _count: { _all: true }, orderBy: { _count: { speaker: "desc" } }, take: 200 }),
    prisma.$queryRaw<{ year: number }[]>`SELECT DISTINCT EXTRACT(YEAR FROM "date")::int AS year FROM "Message" WHERE "date" IS NOT NULL ORDER BY year DESC`,
  ]);
  return {
    total,
    approved,
    inProgress,
    backlog: Math.max(0, total - approved - inProgress),
    needsDetails,
    linkedManuals,
    manualsWritten: Number(manualsWritten) || 0,
    speakers: speakers.map((s) => s.speaker).filter((s): s is string => !!s),
    years: years.map((y) => y.year),
  };
}
