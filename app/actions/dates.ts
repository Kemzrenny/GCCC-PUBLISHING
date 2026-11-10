"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { markSheetDirty } from "@/lib/settings";
import { looksLikeFuture, isoDay } from "@/lib/dates";
import type { ActionResult } from "@/app/actions/messages";

const items = z
  .array(z.object({ id: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.") }))
  .min(1)
  .max(200);

// Confirms (or corrects) upload-day dates from Check dates. The date then counts as
// confirmed: it's no longer marked as an upload date, and Podbean never changes it again.
export async function confirmDates(input: { id: string; date: string }[]): Promise<ActionResult> {
  try {
    const user = await requireUser(["ADMIN", "REVIEWER"]);
    const parsed = items.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const now = new Date();
    let changed = 0;
    for (const { id, date } of parsed.data) {
      const day = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(day.getTime())) return { error: "That isn't a date." };
      if (looksLikeFuture(day)) return { error: `${date} is in the future. Check the year.` };
      const before = await prisma.message.findUnique({ where: { id }, select: { date: true } });
      if (!before) continue;
      const from = isoDay(before.date) || null;
      const moved = from !== date;
      await prisma.$transaction([
        prisma.message.update({ where: { id }, data: { date: day, dateFromUpload: false, detailsLocked: true, dateCheckedAt: now } }),
        ...(moved ? [prisma.messageEdit.create({ data: { messageId: id, userId: user.id, changes: { date: { from, to: date } } } })] : []),
      ]);
      if (moved) {
        changed++;
        // The Google Doc's name includes the date.
        await prisma.$executeRaw`UPDATE "Transcript" SET "driveSyncedAt" = NULL WHERE "messageId" = ${id} AND "driveFileId" IS NOT NULL`;
      }
    }
    await markSheetDirty();
    revalidatePath("/", "layout");
    const n = parsed.data.length;
    return { ok: changed ? `Saved ${n} date${n === 1 ? "" : "s"} (${changed} changed).` : `Confirmed ${n} date${n === 1 ? "" : "s"}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
