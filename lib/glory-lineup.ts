import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { gloryConfig } from "@/lib/glory-config";
import { manualCode, saturdaysIn, teamFor } from "@/lib/glory";
import { LINED_UP, lagosToday } from "@/lib/glory-data";
import { defaultWriters } from "@/lib/glory-series";

// Lining up messages for Glory Home: the coordinator works through one speaker's messages in
// the order they were preached, picking up after the last one made into a manual.

export const lineupSelect = {
  id: true,
  title: true,
  date: true,
  dateFromUpload: true,
  location: true,
  status: true,
  durationSec: true,
} satisfies Prisma.MessageSelect;

export type LineupMessage = Prisma.MessageGetPayload<{ select: typeof lineupSelect }>;

export async function glorySpeaker() {
  return (await getSetting("glorySpeaker")).trim();
}

// The last message (by the day it was preached) already used for a manual or lined up.
export async function lastUsed(speaker: string) {
  return prisma.message.findFirst({
    where: { speaker, date: { not: null }, manuals: { some: {} } },
    orderBy: { date: "desc" },
    select: { id: true, title: true, date: true },
  });
}

export async function nextToLineUp(limit = 12) {
  const speaker = await glorySpeaker();
  if (!speaker) return { speaker, last: null, next: [] as LineupMessage[], skipped: [] as LineupMessage[], skippedCount: 0 };
  const last = await lastUsed(speaker);
  const unused: Prisma.MessageWhereInput = { speaker, manuals: { none: {} }, date: { not: null } };
  const [next, skipped, skippedCount] = await Promise.all([
    prisma.message.findMany({
      where: { ...unused, ...(last?.date ? { date: { gt: last.date } } : {}) },
      orderBy: [{ date: "asc" }, { title: "asc" }],
      take: limit,
      select: lineupSelect,
    }),
    // Earlier messages that were passed over: the ones "lost in the crowd".
    last?.date ? prisma.message.findMany({ where: { ...unused, date: { lt: last.date } }, orderBy: { date: "desc" }, take: 8, select: lineupSelect }) : [],
    last?.date ? prisma.message.count({ where: { ...unused, date: { lt: last.date } } }) : 0,
  ]);
  return { speaker, last, next, skipped, skippedCount };
}

export async function lineUp(messageIds: string[], month: string): Promise<number> {
  let added = 0;
  for (const messageId of messageIds) {
    const exists = await prisma.manual.findFirst({ where: { messageId, ...LINED_UP } });
    if (exists) await prisma.manual.update({ where: { id: exists.id }, data: { plannedMonth: month } });
    else {
      await prisma.manual.create({ data: { messageId, plannedMonth: month, stage: "PLANNED", source: "portal" } });
      added++;
    }
  }
  return added;
}

// Gives this month's free Saturdays to the lined-up messages, oldest sermon first. Each gets
// the next manual number and the month's team as writers; the writers then confirm how many
// manuals it makes.
export async function fillMonth(month: string): Promise<{ planned: number; free: number }> {
  const today = lagosToday();
  const saturdays = saturdaysIn(month).filter((d) => d.getTime() >= today.getTime());
  const taken = await prisma.manual.findMany({ where: { saturday: { in: saturdays } }, select: { saturday: true } });
  const free = saturdays.filter((d) => !taken.some((t) => t.saturday!.getTime() === d.getTime()));
  if (!free.length) return { planned: 0, free: 0 };
  const lined = await prisma.manual.findMany({
    where: { ...LINED_UP, plannedMonth: { lte: month }, messageId: { not: null } },
    include: { message: { select: { date: true } } },
  });
  lined.sort((a, b) => (a.message?.date?.getTime() ?? 0) - (b.message?.date?.getTime() ?? 0));
  const { teams, rotation } = await gloryConfig();
  const writers = defaultWriters(teamFor(month, teams, rotation));
  let planned = 0;
  for (const [i, saturday] of free.entries()) {
    const l = lined[i];
    if (!l) break;
    // The next number after the manuals before this Saturday, unless it's taken.
    const before = await prisma.manual.aggregate({ _max: { number: true }, where: { saturday: { lt: saturday } } });
    let number = (before._max.number ?? 0) + 1;
    while (await prisma.manual.findFirst({ where: { number }, select: { id: true } })) number++;
    await prisma.manual.update({
      where: { id: l.id },
      data: {
        saturday,
        number,
        code: manualCode(number),
        plannedMonth: null,
        seriesId: l.id,
        partsConfirmed: false,
        membersWriter: l.membersWriter ?? writers.membersWriter,
        guideWriter: l.guideWriter ?? writers.guideWriter,
      },
    });
    planned++;
  }
  return { planned, free: free.length };
}
