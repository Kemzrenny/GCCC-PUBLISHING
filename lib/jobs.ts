import "server-only";
import { randomUUID } from "crypto";
import { put, get, del } from "@vercel/blob";
import type { TranscriptionJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { splitAudio } from "@/lib/audio-split";
import { transcribePart, isProvider, type Provider } from "@/lib/transcribe";
import { analyseTranscript, geminiConfigured, geminiTimeline } from "@/lib/gemini";
import { getSetting, markSheetDirty } from "@/lib/settings";
import { appUrl } from "@/lib/site";
import { backupSoon } from "@/lib/drive";
import { audioFromEpisodePage, isPodbeanEpisode } from "@/lib/podbean-parse";
import { Prisma } from "@prisma/client";

// The transcription queue. A sermon is too long to transcribe inside one server request,
// so each job moves forward a step at a time:
//   PREPARE  download the audio from Podbean and cut it into ~10-minute parts (kept in Blob)
//   PART     transcribe the next part
//   TIME     note when each sentence starts in the next part (for following along)
//   FINISH   join the parts, draft the summary and themes, hand it to a reviewer
// A TIMINGS job adds timings to a transcript that already exists: PREPARE, TIME, FINISH, and
// it never changes the transcript's text or the message's status.
// The runner does as many steps as fit in its time, then calls itself again if work is left.

const PART_SECONDS = 10 * 60;
const LOCK_MS = 6 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_AUDIO_BYTES = 400 * 1024 * 1024;

type Segment = { start: number; text: string };
type Part = { pathname: string; durationSec: number; mime: string; ext: string; text?: string; segments?: Segment[] | null };

const isTimings = (job: { kind: string }) => job.kind === "TIMINGS";

// The parts' timings as one timeline for the whole recording, or null if none came back.
function joinTimeline(parts: Part[]): Segment[] | null {
  const out: Segment[] = [];
  let offset = 0;
  for (const p of parts) {
    for (const s of p.segments ?? []) out.push({ start: Math.round((offset + s.start) * 10) / 10, text: s.text });
    offset += p.durationSec || 0;
  }
  return out.length ? out : null;
}

function extFromUrl(url: string): string {
  const m = /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(url).pathname);
  return m ? m[1].toLowerCase() : "mp3";
}

// A message can be transcribed if it has an audio link, or a Podbean episode link the audio
// can be looked up from (older messages from the sheet that aren't in the feed).
export const HAS_AUDIO_SOURCE: Prisma.MessageWhereInput = {
  OR: [{ audioUrl: { not: null } }, { sourceUrl: { contains: "podbean.com/e/" } }],
};

// Queue transcription for these messages. Messages that already have a transcript or an
// active job are skipped. Returns how many were queued.
export async function enqueue(messageIds: string[], opts: { batchId?: string; force?: boolean } = {}): Promise<number> {
  const provider = await getSetting("transcribeProvider");
  const candidates = await prisma.message.findMany({
    where: {
      id: { in: messageIds },
      ...HAS_AUDIO_SOURCE,
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

// Timings for transcripts made before timings existed (or whose timings failed). Only
// messages with a transcript and audio; their text and status are left alone.
export const NEEDS_TIMINGS: Prisma.MessageWhereInput = {
  transcript: { is: { timeline: { equals: Prisma.DbNull } } },
  ...HAS_AUDIO_SOURCE,
  jobs: { none: { status: { in: ["PENDING", "RUNNING"] } } },
};

export async function enqueueTimings(messageIds: string[] | null, limit = 20): Promise<number> {
  const candidates = await prisma.message.findMany({
    where: {
      AND: [
        NEEDS_TIMINGS,
        // The batch skips recordings that already failed, so they don't use up every batch.
        messageIds ? { id: { in: messageIds } } : { jobs: { none: { kind: "TIMINGS", status: "FAILED" } } },
      ],
    },
    orderBy: [{ date: { sort: "desc", nulls: "last" } }],
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true },
  });
  if (!candidates.length) return 0;
  await prisma.transcriptionJob.createMany({
    data: candidates.map((m) => ({ messageId: m.id, provider: "gemini", kind: "TIMINGS" })),
  });
  return candidates.length;
}

// The backlog: the next untranscribed messages that have audio, newest or oldest first.
export async function enqueueBatch(size: number, order: "newest" | "oldest"): Promise<{ queued: number; batchId: string }> {
  const batchId = randomUUID();
  const next = await prisma.message.findMany({
    where: {
      status: "NOT_STARTED",
      ...HAS_AUDIO_SOURCE,
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
    ...(isTimings(job) ? [] : [prisma.message.update({ where: { id: job.messageId }, data: { status: "NOT_STARTED" } })]),
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
  let audioUrl = message.audioUrl;
  if (!audioUrl && isPodbeanEpisode(message.sourceUrl)) {
    // Not in the feed: read the audio's address off the episode page.
    const page = await fetch(message.sourceUrl!, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (GCCC Publishing Portal)" } });
    if (!page.ok) throw new Error(`Couldn't open the Podbean episode page (${page.status}). Check the message's Podbean link.`);
    audioUrl = audioFromEpisodePage(await page.text());
    if (!audioUrl) throw new Error("Couldn't find the audio on the Podbean episode page. Check the message's Podbean link.");
    await prisma.message.update({ where: { id: message.id }, data: { audioUrl } });
  }
  if (!audioUrl) throw new Error("This message has no audio or Podbean link.");
  const res = await fetch(audioUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`Couldn't download the audio (${res.status}).`);
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_AUDIO_BYTES) throw new Error("The audio file is too large to process.");
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = extFromUrl(audioUrl);
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
    prisma.transcriptionJob.update({ where: { id: job.id }, data: { step: isTimings(job) ? "TIME" : "PART", parts: stored, nextPart: 0, nextTime: 0 } }),
    prisma.message.update({
      where: { id: message.id },
      data: { ...(isTimings(job) ? {} : { status: "TRANSCRIBING" }), ...(total && !message.durationSec ? { durationSec: total } : {}) },
    }),
  ]);
}

async function transcribeNext(job: TranscriptionJob) {
  const parts = (job.parts as Part[] | null) ?? [];
  const i = job.nextPart;
  const part = parts[i];
  if (!part) {
    await prisma.transcriptionJob.update({ where: { id: job.id }, data: { step: afterParts() } });
    return;
  }
  const provider: Provider = isProvider(job.provider) ? job.provider : "gemini";
  const { text } = await transcribePart(provider, { buffer: await readBlob(part.pathname), mime: part.mime, ext: part.ext, durationSec: part.durationSec });
  parts[i] = { ...part, text };
  await prisma.transcriptionJob.update({
    where: { id: job.id },
    data: { parts, nextPart: i + 1, attempts: 0, ...(i + 1 >= parts.length ? { step: afterParts() } : {}) },
  });
}

// Timings come from Gemini, whichever service wrote the text.
const afterParts = () => (geminiConfigured() ? "TIME" : "FINISH");

async function timeNext(job: TranscriptionJob) {
  const parts = (job.parts as Part[] | null) ?? [];
  const i = job.nextTime;
  const part = parts[i];
  if (!part) {
    await prisma.transcriptionJob.update({ where: { id: job.id }, data: { step: "FINISH" } });
    return;
  }
  // Timings are a bonus for a new transcript: one part failing leaves a gap the player fills
  // in, rather than holding up the transcript. A timings-only job retries instead.
  let segments: Segment[] | null = null;
  try {
    segments = await geminiTimeline(await readBlob(part.pathname), part.mime, part.durationSec);
  } catch (err) {
    if (isTimings(job)) throw err;
    console.error(`Timings failed for part ${i + 1} of job ${job.id}:`, err);
  }
  parts[i] = { ...part, segments };
  await prisma.transcriptionJob.update({
    where: { id: job.id },
    data: { parts, nextTime: i + 1, attempts: 0, ...(i + 1 >= parts.length ? { step: "FINISH" } : {}) },
  });
}

async function finishTimings(job: TranscriptionJob) {
  const timeline = joinTimeline((job.parts as Part[] | null) ?? []);
  if (!timeline) throw new Error("Gemini couldn't find any speech to time in this recording.");
  await prisma.$transaction([
    prisma.transcript.updateMany({ where: { messageId: job.messageId }, data: { timeline } }),
    prisma.transcriptionJob.update({ where: { id: job.id }, data: { status: "DONE", step: "DONE", lockedAt: null, finishedAt: new Date(), error: null } }),
  ]);
  await cleanupParts(job);
}

async function finish(job: TranscriptionJob) {
  if (isTimings(job)) return finishTimings(job);
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
    const timeline = joinTimeline(parts) ?? Prisma.DbNull;
    const transcript = await tx.transcript.upsert({
      where: { messageId: message.id },
      create: { messageId: message.id, text, provider: job.provider, timeline },
      update: { text, provider: job.provider, approvedAt: null, reviewerId: null, timeline },
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
  await backupSoon(message.id);
}

async function step(job: TranscriptionJob) {
  if (job.step === "PREPARE") return prepare(job);
  if (job.step === "PART") return transcribeNext(job);
  if (job.step === "TIME") return timeNext(job);
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
      ...(isTimings(job) ? [] : [prisma.message.update({ where: { id: job.messageId }, data: { status: "FAILED" as const } })]),
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
  // A step (a download, or one part) can take up to ~2 minutes, so only start one early in
  // the run. Starting late risks being cut off mid-step, which also loses the hand-over.
  while (Date.now() - started < budgetMs * 0.2) {
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

// The safety net. If a run is ever cut off before it hands over, the queue would sit until
// the next scheduled round. Page loads call this: when work is waiting and no run has been
// active for a few minutes, it starts one. Claims are atomic, so an extra start is harmless.
let lastNudge = 0;
export async function nudgeStalledQueue() {
  if (Date.now() - lastNudge < 60_000) return;
  const stale = new Date(Date.now() - LOCK_MS);
  const quiet = new Date(Date.now() - 2 * 60_000);
  const [active, waiting] = await Promise.all([
    prisma.transcriptionJob.count({ where: { status: "RUNNING", lockedAt: { gte: stale } } }),
    prisma.transcriptionJob.count({
      where: { status: { in: ["PENDING", "RUNNING"] }, OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }], updatedAt: { lt: quiet } },
    }),
  ]);
  if (active || !waiting) return;
  lastNudge = Date.now();
  await kickRunner();
}

// True when a job has had no progress for a while (shown as "Paused" until it resumes).
export function jobLooksStalled(job: { lockedAt: Date | null; updatedAt: Date }, now = Date.now()) {
  const idle = now - job.updatedAt.getTime();
  return idle > LOCK_MS && (!job.lockedAt || now - job.lockedAt.getTime() > LOCK_MS);
}
