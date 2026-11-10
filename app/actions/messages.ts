"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { enqueue, enqueueBatch, kickRunner, cancelJob } from "@/lib/jobs";
import { checkPodbean } from "@/lib/podbean";
import { getSettings, markSheetDirty } from "@/lib/settings";
import { normaliseSpeaker } from "@/lib/podbean-parse";
import { looksLikeFuture } from "@/lib/dates";
import { backupSoon } from "@/lib/drive";

export type ActionResult = { ok?: string; error?: string } | null;

const REVIEWERS = ["ADMIN", "REVIEWER"] as const;

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return { error: message };
}

// ---- Transcription queue ----

export async function queueTranscription(messageId: string): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    const queued = await enqueue([messageId], { force: true });
    if (!queued) return { error: "This message has no audio from Podbean yet, or it's already being transcribed." };
    after(kickRunner);
    revalidatePath(`/messages/${messageId}`);
    revalidatePath("/library");
    return { ok: "Queued. The transcript will be ready for review in a few minutes." };
  } catch (err) {
    return fail(err);
  }
}

export async function runNextBatch(): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    const s = await getSettings(["batchSize", "batchOrder"]);
    const { queued } = await enqueueBatch(Number(s.batchSize) || 10, s.batchOrder === "oldest" ? "oldest" : "newest");
    if (!queued) return { ok: "Nothing to queue: every message with audio is transcribed or already in progress." };
    after(kickRunner);
    revalidatePath("/", "layout");
    return { ok: `Queued ${queued} message${queued === 1 ? "" : "s"} for transcription.` };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelTranscription(jobId: string): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    await cancelJob(jobId);
    revalidatePath("/", "layout");
    return { ok: "Cancelled." };
  } catch (err) {
    return fail(err);
  }
}

export async function checkPodbeanNow(): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    const r = await checkPodbean();
    if (r.queued) after(kickRunner);
    revalidatePath("/", "layout");
    const parts = [`${r.added} new message${r.added === 1 ? "" : "s"}`];
    if (r.needsDetails) parts.push(`${r.needsDetails} need details`);
    if (r.queued) parts.push(`${r.queued} queued for transcription`);
    return { ok: `Checked Podbean: ${parts.join(", ")}.` };
  } catch (err) {
    return fail(err);
  }
}

// ---- Message details ----

const detailsSchema = z.object({
  title: z.string().trim().min(2, "Enter a title.").max(300),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date the message was preached."),
  speaker: z.string().trim().max(120),
  series: z.string().trim().max(200),
  location: z.string().trim().max(200),
});

export async function saveDetails(messageId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser([...REVIEWERS]);
    const parsed = detailsSchema.safeParse(Object.fromEntries(["title", "date", "speaker", "series", "location"].map((k) => [k, String(form.get(k) ?? "")])));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (looksLikeFuture(new Date(`${d.date}T00:00:00Z`))) return { error: "That date is in the future. Check the year." };
    const before = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    const next = {
      title: d.title,
      date: new Date(`${d.date}T00:00:00Z`),
      speaker: normaliseSpeaker(d.speaker),
      series: d.series || null,
      location: d.location || null,
    };
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    for (const [k, v] of Object.entries(next)) {
      const old = before[k as keyof typeof next];
      const a = old instanceof Date ? old.toISOString().slice(0, 10) : ((old as string | null) ?? null);
      const b = v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string | null) ?? null);
      if (a !== b) changes[k] = { from: a, to: b };
    }
    await prisma.$transaction([
      prisma.message.update({
        where: { id: messageId },
        data: { ...next, needsDetails: false, detailsLocked: true, suggestedTitle: null },
      }),
      ...(Object.keys(changes).length ? [prisma.messageEdit.create({ data: { messageId, userId: user.id, changes } })] : []),
    ]);
    await markSheetDirty();
    // The Doc's name and header use these details: refresh it at the next round.
    await prisma.$executeRaw`UPDATE "Transcript" SET "driveSyncedAt" = NULL WHERE "messageId" = ${messageId} AND "driveFileId" IS NOT NULL`;
    revalidatePath("/", "layout");
    return { ok: "Saved. Podbean won't overwrite these details." };
  } catch (err) {
    return fail(err);
  }
}

// ---- Transcript review ----

const textSchema = z.string().max(2_000_000);

export async function saveTranscript(messageId: string, text: string): Promise<ActionResult> {
  try {
    const user = await requireUser([...REVIEWERS]);
    const body = textSchema.parse(text).trim();
    if (!body) return { error: "The transcript is empty." };
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { transcript: true } });
    await prisma.$transaction(async (tx) => {
      const t = message.transcript
        ? await tx.transcript.update({ where: { id: message.transcript.id }, data: { text: body, reviewerId: user.id } })
        : await tx.transcript.create({ data: { messageId, text: body, provider: "manual", reviewerId: user.id } });
      await tx.transcriptVersion.create({ data: { transcriptId: t.id, text: body, kind: "edit", authorId: user.id } });
      if (message.status !== "APPROVED") await tx.message.update({ where: { id: messageId }, data: { status: "IN_REVIEW" } });
    });
    revalidatePath(`/messages/${messageId}`);
    revalidatePath("/review");
    return { ok: "Saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function approveTranscript(messageId: string, text: string): Promise<ActionResult> {
  try {
    const user = await requireUser([...REVIEWERS]);
    const body = textSchema.parse(text).trim();
    if (!body) return { error: "The transcript is empty." };
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { transcript: true } });
    if (message.needsDetails) return { error: "Confirm the message's title and date first, then approve." };
    await prisma.$transaction(async (tx) => {
      const t = message.transcript
        ? await tx.transcript.update({ where: { id: message.transcript.id }, data: { text: body, reviewerId: user.id, approvedAt: new Date() } })
        : await tx.transcript.create({ data: { messageId, text: body, provider: "manual", reviewerId: user.id, approvedAt: new Date() } });
      await tx.transcriptVersion.create({ data: { transcriptId: t.id, text: body, kind: "approve", authorId: user.id } });
      await tx.message.update({ where: { id: messageId }, data: { status: "APPROVED" } });
    });
    await markSheetDirty();
    after(() => backupSoon(messageId));
    revalidatePath("/", "layout");
    return { ok: "Approved. It's now in the library for writers." };
  } catch (err) {
    return fail(err);
  }
}

export async function reopenTranscript(messageId: string): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    await prisma.$transaction([
      prisma.transcript.update({ where: { messageId }, data: { approvedAt: null } }),
      prisma.message.update({ where: { id: messageId }, data: { status: "IN_REVIEW" } }),
    ]);
    await markSheetDirty();
    revalidatePath("/", "layout");
    return { ok: "Reopened for review." };
  } catch (err) {
    return fail(err);
  }
}

// ---- Assignment ----

export async function assignReviewer(messageId: string, userId: string | null): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    await prisma.message.update({ where: { id: messageId }, data: { assigneeId: userId || null, ...(userId ? { assigneeName: null, dueLabel: null } : {}) } });
    await markSheetDirty();
    revalidatePath(`/messages/${messageId}`);
    revalidatePath("/library");
    return { ok: "Updated." };
  } catch (err) {
    return fail(err);
  }
}
