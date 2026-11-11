"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { enqueue, enqueueBatch, enqueueTimings, kickRunner, cancelJob } from "@/lib/jobs";
import { geminiConfigured } from "@/lib/gemini";
import { checkPodbean, finishLookups } from "@/lib/podbean";
import { getSettings, markSheetDirty } from "@/lib/settings";
import { looksLikeFuture } from "@/lib/dates";
import { backupSoon, backupPending } from "@/lib/drive";
import { resolveSpeaker } from "@/lib/speakers";

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
    if (!queued) return { error: "This message has no Podbean link to get the audio from, or it's already being transcribed." };
    after(kickRunner);
    revalidatePath(`/messages/${messageId}`);
    revalidatePath("/library");
    return { ok: "Queued. The transcript will be ready for review in a few minutes." };
  } catch (err) {
    return fail(err);
  }
}

// The next batch, from one speaker if given, else the speaker chosen in Settings (or everyone).
export async function runNextBatch(onlySpeaker?: string): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    const s = await getSettings(["batchSize", "batchOrder", "batchSpeaker"]);
    const speaker = (typeof onlySpeaker === "string" ? onlySpeaker : s.batchSpeaker) || null;
    const { queued } = await enqueueBatch(Number(s.batchSize) || 10, s.batchOrder === "oldest" ? "oldest" : "newest", speaker);
    if (!queued && speaker) return { ok: `Nothing to queue: every message by ${speaker} with Podbean audio is transcribed or already in progress.` };
    if (queued && speaker) {
      after(kickRunner);
      revalidatePath("/", "layout");
      return { ok: `Queued ${queued} message${queued === 1 ? "" : "s"} by ${speaker}.` };
    }
    if (!queued) {
      const noLink = await prisma.message.count({ where: { status: "NOT_STARTED", externalTranscriptUrl: null, audioUrl: null, NOT: { sourceUrl: { contains: "podbean.com/e/" } } } });
      return {
        ok: noLink
          ? `Nothing to queue. ${noLink} untranscribed message${noLink === 1 ? " has" : "s have"} no Podbean link, so there's no audio to transcribe.`
          : "Nothing to queue: every message is transcribed or already in progress.",
      };
    }
    after(kickRunner);
    revalidatePath("/", "layout");
    return { ok: `Queued ${queued} message${queued === 1 ? "" : "s"} for transcription.` };
  } catch (err) {
    return fail(err);
  }
}

// ---- Timings (follow along while listening) ----

export async function queueTimings(messageId: string): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    if (!geminiConfigured()) return { error: "Timings need Gemini. Add GEMINI_API_KEY in Vercel first." };
    const queued = await enqueueTimings([messageId]);
    if (!queued) return { error: "This message has no audio to time, or it's already being worked on." };
    after(kickRunner);
    revalidatePath(`/messages/${messageId}`);
    return { ok: "Adding timings. This takes a few minutes; you can keep editing meanwhile." };
  } catch (err) {
    return fail(err);
  }
}

export async function queueTimingsBatch(): Promise<ActionResult> {
  try {
    await requireUser([...REVIEWERS]);
    if (!geminiConfigured()) return { error: "Timings need Gemini. Add GEMINI_API_KEY in Vercel first." };
    const s = await getSettings(["batchSize"]);
    const queued = await enqueueTimings(null, Number(s.batchSize) || 10);
    if (!queued) return { ok: "Every transcript with audio already has timings." };
    after(kickRunner);
    revalidatePath("/settings");
    return { ok: `Adding timings to ${queued} transcript${queued === 1 ? "" : "s"}.` };
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
    // Older episodes still to look up: carry on in the background.
    if (r.report?.toLookUp) after(() => finishLookups().catch(() => {}));
    revalidatePath("/", "layout");
    const parts = [`${r.added} new message${r.added === 1 ? "" : "s"}`, `${r.resolved} waiting message${r.resolved === 1 ? "" : "s"} filled in`];
    if (r.queued) parts.push(`${r.queued} queued for transcription`);
    const left = r.report?.waiting ?? 0;
    const more = r.report?.toLookUp ? ` Reading the other ${r.report.toLookUp} older episodes in the background: refresh in a few minutes.` : "";
    return { ok: `Checked Podbean: ${parts.join(", ")}. ${left} still waiting.${more}` };
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
      speaker: await resolveSpeaker(d.speaker),
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
        data: { ...next, needsDetails: false, detailsLocked: true, dateFromUpload: false, dateCheckedAt: before.dateFromUpload ? new Date() : before.dateCheckedAt, suggestedTitle: null },
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

// Approves many transcripts at once from the review queue. Messages whose title or date
// still need confirming are skipped, as they are when approving one by one.
export async function approveMany(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser([...REVIEWERS]);
    const list = z.array(z.string().min(1)).min(1, "Tick at least one message.").max(500).parse(ids);
    const rows = await prisma.message.findMany({
      where: { id: { in: list }, status: { in: ["AI_DRAFT", "IN_REVIEW"] } },
      select: { id: true, needsDetails: true, transcript: { select: { id: true, text: true } } },
    });
    const ready = rows.filter((r) => !r.needsDetails && r.transcript?.text.trim());
    const now = new Date();
    for (const r of ready) {
      await prisma.$transaction([
        prisma.transcript.update({ where: { id: r.transcript!.id }, data: { approvedAt: now, reviewerId: user.id } }),
        prisma.transcriptVersion.create({ data: { transcriptId: r.transcript!.id, text: r.transcript!.text, kind: "approve", authorId: user.id } }),
        prisma.message.update({ where: { id: r.id }, data: { status: "APPROVED" } }),
      ]);
    }
    if (ready.length) {
      await markSheetDirty();
      // Their Google Docs pick up the approval at the next backup round; start one now.
      after(() => backupPending(Math.min(ready.length, 40)).catch(() => {}));
    }
    revalidatePath("/", "layout");
    const skipped = rows.length - ready.length;
    if (!ready.length) return { error: "None of these can be approved yet: confirm their title and date first." };
    return {
      ok: `Approved ${ready.length} transcript${ready.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped: confirm their title and date first.` : ""}`,
    };
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
