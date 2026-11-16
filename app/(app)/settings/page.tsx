import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PROVIDERS, PROVIDER_LABELS, providerConfigured } from "@/lib/transcribe";
import { HAS_AUDIO_SOURCE, NEEDS_TIMINGS, geminiPause } from "@/lib/jobs";
import { lagosTime } from "@/lib/dates";
import ActionButton from "@/components/ActionButton";
import { Chip } from "@/components/ui";
import { TranscriptionSettings } from "@/components/SettingsForms";
import { Section, Row, Stat } from "@/components/settings/Section";
import { runQueueNow } from "@/app/actions/admin";
import { runNextBatch, queueTimingsBatch } from "@/app/actions/messages";

export const metadata = { title: "Settings · Transcription" };

export default async function TranscriptionSettingsPage() {
  const untranscribed = { status: "NOT_STARTED" as const, externalTranscriptUrl: null };
  const [s, queue, ready, noLink, readyBySpeaker, untimed, paused] = await Promise.all([
    getSettings(["transcribeProvider", "batchSize", "batchOrder", "batchSpeaker", "autoTranscribeNew"]),
    prisma.transcriptionJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    prisma.message.count({ where: { ...untranscribed, ...HAS_AUDIO_SOURCE } }),
    prisma.message.count({ where: { ...untranscribed, NOT: HAS_AUDIO_SOURCE } }),
    prisma.message.groupBy({
      by: ["speaker"],
      where: { ...untranscribed, ...HAS_AUDIO_SOURCE, speaker: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { speaker: "desc" } },
    }),
    prisma.message.count({ where: NEEDS_TIMINGS }),
    geminiPause(),
  ]);
  const speakers = readyBySpeaker.map((r) => ({ name: r.speaker!, ready: r._count._all }));
  const batchSpeaker = s.batchSpeaker || null;
  const speakerLeft = batchSpeaker ? (speakers.find((r) => r.name === batchSpeaker)?.ready ?? 0) : null;

  return (
    <>
      <Section
        title="Queue"
        description="Messages are transcribed one at a time, in the background. You can leave the portal while it works."
        status={paused ? <Chip tone="red">Paused until {lagosTime(paused)}</Chip> : queue ? <Chip tone="blue">Working</Chip> : <Chip tone="grey">Idle</Chip>}
      >
        <Row>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat value={queue.toLocaleString()} label="in the queue now" />
            <Stat value={ready.toLocaleString()} label="ready to transcribe" />
            <Stat value={noLink.toLocaleString()} label="no Podbean audio yet" />
          </div>
          {paused && (
            <p className="text-[13px] text-muted">Gemini’s free daily limit is used up. The queue carries on by itself at about {lagosTime(paused)}.</p>
          )}
        </Row>
        <Row
          title="Add work"
          hint={`Takes the next ${s.batchSize} untranscribed messages, ${s.batchOrder === "oldest" ? "oldest" : "newest"} first${batchSpeaker ? `, by ${batchSpeaker} (${speakerLeft?.toLocaleString()} left)` : ""}. Change this under Batches below.`}
        >
          <div>
            <ActionButton action={runNextBatch} className="btn-primary" pendingLabel="Queueing…">
              Queue the next {s.batchSize}
              {batchSpeaker ? ` by ${batchSpeaker}` : ""}
            </ActionButton>
          </div>
        </Row>
        <Row title="Stuck?" hint="Restarts work on messages already in the queue. It doesn’t add new ones.">
          <div>
            <ActionButton action={runQueueNow} pendingLabel="Starting…">
              Resume the queue
            </ActionButton>
          </div>
        </Row>
        {untimed > 0 && (
          <Row
            title="Follow-along timings"
            hint="Lets the transcript highlight each sentence as the audio plays. New transcripts get them automatically."
          >
            <p className="text-sm">
              <span className="font-medium">{untimed.toLocaleString()}</span> older transcript{untimed === 1 ? "" : "s"} don’t have timings yet.
            </p>
            <div>
              <ActionButton action={queueTimingsBatch} pendingLabel="Queueing…">
                Add timings to the next {Math.min(Number(s.batchSize) || 10, untimed)}
              </ActionButton>
            </div>
          </Row>
        )}
      </Section>

      <TranscriptionSettings
        values={s}
        providers={PROVIDERS.map((p) => ({ key: p, label: PROVIDER_LABELS[p], ready: providerConfigured(p) }))}
        speakers={speakers}
      />
    </>
  );
}
