import "server-only";
import { randomUUID } from "crypto";
import { put, get, del } from "@vercel/blob";
import type { TranscriptionJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { splitAudio } from "@/lib/audio-split";
import { transcribePart, isProvider, type Provider } from "@/lib/transcribe";
import { analyseTranscript, geminiConfigured } from "@/lib/gemini";
import { getSetting, markSheetDirty } from "@/lib/settings";
import { appUrl } from "@/lib/site";

// The transcription queue. A sermon is too long to transcribe inside one server request,
// so each job moves forward a step at a time:
//   PREPARE  download the audio from Podbean and cut it into ~10-minute parts (kept in Blob)
//   PART     transcribe the next part
//   FINISH   join the parts, draft the summary and themes, hand it to a reviewer
// The runner does as many steps as fit in its time, then calls itself again if work is left.

const PART_SECONDS = 10 * 60;
const LOCK_MS = 6 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_AUDIO_BYTES = 400 * 1024 * 1024;

type Part = { pathname: string; durationSec: number; mime: string; ext: string; text?: string };

function extFromUrl(url: string): string {
  const m = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(url).pathname);
  return m ? m[1].toLowerCase() : "mp3";
}

// Queue transcription for these messages. Messages that already have a transcript or an
// active job are skipped. Returns how many were queued.
export async function enqueue(messageIds: string[], opts: { batchId?: string; force?: boolean } = {}): Promise<number> {
  const provider = await getSetting("transcribeProvider");
  const candidates = await prisma.message.findMany({
    where: {
      id: { in: messageIds },
      audioUrl: { not: null },
      ...(opts.force ? {} : { status: { in: ["NOT_STARTED", "FAILED"] } }),
      jobs: { none: { status: { in: ["PENDING", "RUNNING"] } } },
    },
    select: { id: true },
  });
  if (!candidates.length) return 0;
  await prisma.$transaction([
    prisma.transcriptionJob.createMany({
      data: candidates.map((m) => ({ messageId: m.id, provider, batchId: opts.batchId ?? null })),
    }),
    prisma.message.updateMany({ where: { id: { in: candidates.map((c) => c.id) } }, data: { status: "QUEUED" } }),
  ]);
  return candidates.length;
}

// The backlog: the next untranscribed messages that have audio, newest or oldest first.
export async function enqueueBatch(size: number, order: "newest" | "oldest"): Promise<{ queued: number; batchId: string }> {
  const batchId = randomUUID();
  const next = await prisma.message.findMany({
    where: {
      status: "NOT_STARTED",
      audioUrl: { not: null },
      externalTranscriptUrl: null,
      jobs: { none: { status: { in: ["PENDING", "RUNNING"] } } },
    },
    orderBy: [{ date: order === "newest" ? "desc" : "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(size, 1), 50),
    select: { id: true },
  });
  return { queued: await enqueue(next.map((n) => n.id), { batchId }), batchId };
}

export async function cancelJob(jobId: string) {
  const job = await prisma.transcriptionJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === "DONE") return;
  await cleanupParts(job);
  await prisma.$transaction([
    prisma.transcriptionJob.update({ where: { id: jobId }, data: { status: "CANCELLED", lockedAt: null, finishedAt: new Date() } }),
    prisma.message.update({ where: { id: job.messageId }, data: { status: "NOT_STARTED" } }),
  ]);
}

async function claimNext(): Promise<TranscriptionJob | null> {
  const stale = new Date(Date.now() - LOCK_MS);
  for (let tries = 0; tries < 5; tries++) {
    const job = await prisma.transcriptionJob.findFirst({
      where: { status: { in: ["RUNNING", "PENDING"] }, OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }] },
      // Finish what's started before starting something new.
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    });
    if (!job) return null;
    const won = await prisma.transcriptionJob.updateMany({
      where: { id: job.id, OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }] },
      data: { lockedAt: new Date(), status: "RUNNING", startedAt: job.startedAt ?? new Date() },
    });
    if (won.count === 1) return prisma.transcriptionJob.findUnique({ where: { id: job.id } });
  }
  return null;
}

async function readBlob(pathname: string): Promise<Buffer> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error("A stored audio part is missing.");
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function cleanupParts(job: TranscriptionJob) {
  const parts = (job.parts as Part[] | null) ?? [];
  if (parts.length) await del(parts.map((p) => p.pathname)).catch(() => {});
}

async function prepare(job: TranscriptionJob) {
  const message = await prisma.message.findUniqueOrThrow({ where: { id: job.messageId } });
  if (!message.audioUrl) throw new Error("This message has no audio link from Podbean.");
  const res = await fetch(message.audioUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`Couldn't download the audio (${res.status}).`);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_AUDIO_BYTES) throw new Error("The audio file is too large to process.");
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = extFromUrl(message.audioUrl);
  const { total, parts } = await splitAudio(buffer, ext, PART_SECONDS);
  const pieces = parts ?? [{ buffer, durationSec: total, ext, mime: ext === "mp3" ? "audio/mpeg" : `audio/${ext}` }];
  const stored: Part[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const blob = await put(`audio/${message.id}/${job.id}/part${String(i + 1).padStart(2, "0")}.${p.ext}`, p.buffer, {
      access: "private",
      contentType: p.mime,
      allowOverwrite: true,
    });
    stored.push({ pathname: blob.pathname, durationSec: p.durationSec, mime: p.mime, ext: p.ext });
  }
  await prisma.$transaction([
    prisma.transcriptionJob.update({ where: { id: job.id }, data: { step: "PART", parts: stored, nextPart: 0 } }),
    prisma.message.update({
      where: { id: message.id },
      data: { status: "TRANSCRIBING", ...(total && !message.durationSec ? { durationSec: total } : {}) },
    }),
  ]);
}

async function transcribeNext(job: TranscriptionJob) {
  const parts = (job.parts as Part[] | null) ?? [];
  const i = job.nextPart;
  const part = parts[i];
  if (!part) {
    await prisma.transcriptionJob.update({ where: { id: job.id }, data: { step: "FINISH" } });
    return;
  }
  const provider: Provider = isProvider(job.provider) ? job.provider : "gemini";
  const { text } = await transcribePart(provider, { buffer: await readBlob(part.pathname), mime: part.mime, ext: part.ext, durationSec: part.durationSec });
  parts[i] = { ...part, text };
  await prisma.transcriptionJob.update({
    where: { id: job.id },
    data: { parts, nextPart: i + 1, attempts: 0, ...(i + 1 >= parts.length ? { step: "FINISH" } : {}) },
  });
}

async function finish(job: TranscriptionJob) {
  const parts = (job.parts as Part[] | null) ?? [];
  const text = parts.map((p) => (p.text ?? "").trim()).filter(Boolean).join("\n\n");
  if (!text) throw new Error("No speech was found in the recording.");
  const message = await prisma.message.findUniqueOrThrow({ where: { id: job.messageId } });

  // The summary is a bonus: if it fails, the transcript still goes to review.
  let analysis: Awaited<ReturnType<typeof analyseTranscript>> | null = null;
  if (geminiConfigured()) {
    analysis = await analyseTranscript(text, { title: message.needsDetails ? null : message.title, speaker: message.speaker }).catch((err) => {
      console.error("Analysis failed:", err);
      return null;
    });
  }

  await prisma.$transaction(async (tx) => {
    const transcript = await tx.transcript.upsert({
      where: { messageId: message.id },
      create: { messageId: message.id, text, provider: job.provider },
      update: { text, provider: job.provider, approvedAt: null, reviewerId: null },
    });
    await tx.transcriptVersion.create({ data: { transcriptId: transcript.id, text, kind: "ai" } });
    await tx.message.update({
      where: { id: message.id },
      data: {
        status: "AI_DRAFT",
        ...(analysis
          ? {
              summary: message.summary ?? analysis.summary,
              themes: message.themes.length ? message.themes : analysis.themes.slice(0, 8),
              scriptures: analysis.scriptures.slice(0, 20),
              tractPotential: message.tractPotential || analysis.tractPotential,
              bookPotential: message.bookPotential || analysis.bookPotential,
              suggestedTitle: message.needsDetails ? analysis.suggestedTitle || null : null,
            }
          : {}),
      },
    });
    await tx.transcriptionJob.update({
      where: { id: job.id },
      data: { status: "DONE", step: "DONE", lockedAt: null, finishedAt: new Date(), error: null },
    });
  });
  await cleanupParts(job);
  await markSheetDirty();
}

async function step(job: TranscriptionJob) {
  if (job.step === "PREPARE") return prepare(job);
  if (job.step === "PART") return transcribeNext(job);
  if (job.step === "FINISH") return finish(job);
}

async function fail(job: TranscriptionJob, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = job.attempts + 1;
  console.error(`Transcription job ${job.id} (${job.step}) failed, attempt ${attempts}:`, message);
  if (attempts >= MAX_ATTEMPTS) {
    await cleanupParts(job);
    await prisma.$transaction([
      prisma.transcriptionJob.update({
        where: { id: job.id },
        data: { status: "FAILED", attempts, error: message.slice(0, 1000), lockedAt: null, finishedAt: new Date() },
      }),
      prisma.message.update({ where: { id: job.messageId }, data: { status: "FAILED" } }),
    ]);
  } else {
    await prisma.transcriptionJob.update({ where: { id: job.id }, data: { attempts, error: message.slice(0, 1000), lockedAt: null } });
  }
}

// Works through the queue until the time budget is used. Returns what it did and whether
// work is left, so the caller can schedule another run.
export async function runJobs(budgetMs: number): Promise<{ steps: number; remaining: number }> {
  const started = Date.now();
  let steps = 0;
  // Each step can take a few minutes (a download, or one part); don't start one late.
  while (Date.now() - started < budgetMs * 0.4) {
    const job = await claimNext();
    if (!job) break;
    try {
      await step(job);
      await prisma.transcriptionJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { lockedAt: null } });
    } catch (err) {
      await fail(job, err);
    }
    steps++;
  }
  const remaining = await prisma.transcriptionJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  return { steps, remaining };
}

// Starts a runner in a new request (fire and forget), so the queue keeps moving after the
// request that queued the work has answered.
export async function kickRunner() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  await fetch(`${appUrl()}/api/jobs/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
