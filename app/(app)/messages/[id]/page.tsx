import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, ArrowLeft } from "lucide-react";
import { currentUser, canReview } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDuration, isoDay } from "@/lib/dates";
import { STAGE_LABEL, monthLabel, saturdayFrom, type Stage } from "@/lib/glory";
import { lagosToday } from "@/lib/glory-data";
import { missingDetails, titleKnown } from "@/lib/needs";
import { PROVIDER_LABELS, isProvider } from "@/lib/transcribe";
import { StatusChip, Chip } from "@/components/ui";
import DetailsForm from "@/components/DetailsForm";
import { confirmDates } from "@/app/actions/dates";
import TranscriptPanel from "@/components/TranscriptPanel";
import { readTimeline } from "@/lib/align";
import AutoRefresh from "@/components/AutoRefresh";
import ActionButton from "@/components/ActionButton";
import { queueTranscription, cancelTranscription } from "@/app/actions/messages";
import { jobLooksStalled } from "@/lib/jobs";
import { isPodbeanEpisode } from "@/lib/podbean-parse";

export async function generateMetadata({ params }: PageProps<"/messages/[id]">) {
  const m = await prisma.message.findUnique({ where: { id: (await params).id }, select: { title: true } });
  return { title: m?.title ?? "Message" };
}

export default async function MessagePage({ params }: PageProps<"/messages/[id]">) {
  const user = await currentUser();
  const reviewer = canReview(user.role);
  const { id } = await params;
  const m = await prisma.message.findUnique({
    where: { id },
    include: {
      transcript: { include: { reviewer: { select: { name: true } }, _count: { select: { versions: true } } } },
      jobs: { orderBy: { createdAt: "desc" }, take: 6 },
      manuals: { orderBy: [{ saturday: { sort: "asc", nulls: "last" } }, { number: "asc" }] },
      assignee: { select: { name: true } },
      edits: { orderBy: { createdAt: "desc" }, take: 5, include: { user: { select: { name: true } } } },
    },
  });
  if (!m) notFound();
  const speakers = reviewer
    ? (await prisma.message.groupBy({ by: ["speaker"], orderBy: { _count: { speaker: "desc" } }, take: 30 })).map((s) => s.speaker).filter((s): s is string => !!s)
    : [];
  const manuals = m.manuals;
  // The first Saturday from today with no manual, for "Plan a manual from this message".
  const freeSaturday = await (async () => {
    let d = saturdayFrom(lagosToday());
    for (let i = 0; i < 26; i++, d = new Date(d.getTime() + 7 * 86_400_000)) {
      if (!(await prisma.manual.findFirst({ where: { saturday: d }, select: { id: true } }))) return d.toISOString().slice(0, 10);
    }
    return null;
  })();
  const isActive = (j: { status: string }) => j.status === "PENDING" || j.status === "RUNNING";
  // Transcription and timings are separate jobs: only transcription replaces the transcript box.
  const job = m.jobs.find((j) => j.kind !== "TIMINGS");
  const activeJob = job && isActive(job) ? job : null;
  const timingsJob = m.jobs.find((j) => j.kind === "TIMINGS");
  const timeline = readTimeline(m.transcript?.timeline);
  const parts = (activeJob?.parts as { text?: string }[] | null) ?? [];
  const meta = [m.date && m.dateFromUpload ? `${formatDate(m.date)} (Podbean upload date)` : formatDate(m.date), m.speaker, m.series, m.location].filter(Boolean);

  return (
    <>
      <Link href="/library" className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink">
        <ArrowLeft aria-hidden size={16} /> Message library
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={m.status} needsDetails={m.needsDetails} />
          {m.needsDetails && m.status !== "NOT_STARTED" && <Chip tone="red">Needs details</Chip>}
          {m.legacyId && <span className="text-xs text-muted">Sheet ID {m.legacyId}</span>}
        </div>
        <h1 className="font-display text-4xl leading-tight font-semibold sm:text-5xl">{m.title}</h1>
        <p className="text-base text-muted">{meta.join(" · ") || "No details yet"}</p>
        {reviewer && m.date && m.dateFromUpload && !m.needsDetails && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>This date is the day it went up on Podbean. Right date? Confirm it, or change it under Edit details.</span>
            <ActionButton action={confirmDates.bind(null, [{ id: m.id, date: isoDay(m.date) }])} pendingLabel="Confirming…">
              Date is right
            </ActionButton>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {m.needsDetails && reviewer && (
            <section className="card flex flex-col gap-4 border-[var(--chip-red-bg)] p-6">
              <div>
                <h2 className="font-display text-xl font-semibold">Confirm the details</h2>
                <p className="text-sm text-muted">This message still needs {missingDetails(m).join(" and ") || "a check"}.</p>
              </div>
              <DetailsForm
                messageId={m.id}
                initial={{ title: titleKnown(m) ? m.title : "", date: isoDay(m.date), speaker: m.speaker ?? "", series: m.series ?? "", location: m.location ?? "" }}
                suggestedTitle={m.suggestedTitle}
                podbeanTitle={m.podbeanTitle}
                speakers={speakers}
              />
            </section>
          )}

          <section id="transcript" className="card flex scroll-mt-6 flex-col gap-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold">Transcript</h2>
              {m.transcript && (
                <span className="text-sm text-muted">
                  {m.transcript.provider === "import" || m.transcript.provider === "manual"
                    ? "Typed by the team"
                    : `Drafted by ${isProvider(m.transcript.provider) ? PROVIDER_LABELS[m.transcript.provider] : m.transcript.provider}`}
                  {m.transcript.reviewer && ` · reviewed by ${m.transcript.reviewer.name}`}
                  {m.transcript._count.versions > 1 && ` · ${m.transcript._count.versions} versions`}
                  {m.transcript.driveUrl && (
                    <>
                      {" · "}
                      <a className="link inline-flex items-center gap-1" href={m.transcript.driveUrl} target="_blank" rel="noreferrer">
                        Google Doc <ExternalLink aria-hidden size={13} />
                      </a>
                    </>
                  )}
                </span>
              )}
            </div>

            {activeJob ? (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-banner p-5">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {activeJob.step === "PREPARE" && (activeJob.status === "PENDING" ? "Waiting in the queue" : "Downloading and preparing the audio")}
                    {activeJob.step === "PART" && `Transcribing part ${Math.min(activeJob.nextPart + 1, parts.length)} of ${parts.length}`}
                    {activeJob.step === "TIME" && `Matching the text to the audio, part ${Math.min(activeJob.nextTime + 1, parts.length)} of ${parts.length}`}
                    {activeJob.step === "FINISH" && "Putting the transcript together"}
                  </span>
                  <span className="text-sm text-muted">
                    {activeJob.error
                      ? `Retrying (${activeJob.attempts} of 3) after a problem: ${activeJob.error}`
                      : activeJob.status === "RUNNING" && jobLooksStalled(activeJob)
                        ? "Paused. It restarts on its own now."
                        : "The transcript appears here once it's ready."}
                  </span>
                  <AutoRefresh />
                </div>
                {reviewer && (
                  <ActionButton action={cancelTranscription.bind(null, activeJob.id)} confirm="Stop this transcription?">
                    Cancel
                  </ActionButton>
                )}
              </div>
            ) : m.transcript ? (
              <TranscriptPanel
                key={m.transcript.updatedAt.toISOString()}
                messageId={m.id}
                text={m.transcript.text}
                audioUrl={m.audioUrl}
                timeline={timeline}
                timingsRunning={!!timingsJob && isActive(timingsJob)}
                timingsFailed={!timeline && timingsJob?.status === "FAILED" ? timingsJob.error : null}
                approved={m.status === "APPROVED"}
                canEdit={reviewer}
                needsDetails={m.needsDetails}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {m.externalTranscriptUrl ? (
                  <p className="text-[15px]">
                    Transcribed before the portal.{" "}
                    <a className="link inline-flex items-center gap-1" href={m.externalTranscriptUrl} target="_blank" rel="noreferrer">
                      Open the transcript <ExternalLink aria-hidden size={14} />
                    </a>
                  </p>
                ) : (
                  <p className="text-[15px] text-muted">
                    {m.audioUrl || isPodbeanEpisode(m.sourceUrl)
                      ? "Not transcribed yet."
                      : "No Podbean link for this message. Add its Podbean episode link to the sheet and import again, or wait for it to appear in the feed."}
                  </p>
                )}
                {job?.status === "FAILED" && <p className="text-sm text-alert">The last attempt failed: {job.error}</p>}
                {reviewer && (m.audioUrl || isPodbeanEpisode(m.sourceUrl)) && (
                  <div>
                    <ActionButton action={queueTranscription.bind(null, m.id)} className="btn-primary" pendingLabel="Queueing…">
                      {job?.status === "FAILED" ? "Try again" : m.externalTranscriptUrl ? "Transcribe in the portal" : "Transcribe now"}
                    </ActionButton>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          {m.audioUrl && (!m.transcript || activeJob) && (
            <section className="card flex flex-col gap-3 p-6 xl:sticky xl:top-6">
              <h2 className="font-display text-lg font-semibold">Listen</h2>
              <audio controls preload="none" src={m.audioUrl} className="w-full" />
              <span className="text-sm text-muted">{formatDuration(m.durationSec)}</span>
            </section>
          )}

          <section className="card flex flex-col gap-4 p-6">
            <h2 className="font-display text-lg font-semibold">About this message</h2>
            {m.summary ? <p className="text-sm leading-6">{m.summary}</p> : <p className="text-sm text-muted">A summary is drafted once the transcript is ready.</p>}
            {m.themes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {m.themes.map((t) => (
                  <Link key={t} href={`/library?q=${encodeURIComponent(t)}`} className="rounded-full bg-field px-3 py-1 text-xs font-medium hover:bg-nav-on">
                    {t}
                  </Link>
                ))}
              </div>
            )}
            {m.scriptures.length > 0 && <p className="text-sm text-muted">Scriptures: {m.scriptures.join(", ")}</p>}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Tract potential</dt>
              <dd>{m.tractPotential ? "Yes" : "Not flagged"}</dd>
              <dt className="text-muted">Book potential</dt>
              <dd>{m.bookPotential ? "Yes" : "Not flagged"}</dd>
              <dt className="text-muted">Assigned</dt>
              <dd>{m.assignee?.name ?? m.assigneeName ?? "Unassigned"}{m.dueLabel ? ` (due ${m.dueLabel})` : ""}</dd>
              {m.sourceUrl && (
                <>
                  <dt className="text-muted">Podbean</dt>
                  <dd>
                    <a className="link inline-flex items-center gap-1" href={m.sourceUrl} target="_blank" rel="noreferrer">
                      Episode page <ExternalLink aria-hidden size={13} />
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-display text-lg font-semibold">Glory Home</h2>
            {manuals.length === 0 ? (
              <p className="text-sm text-muted">Not used for a Glory Home manual yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {manuals.map((man) => (
                  <li key={man.id} className="text-sm">
                    <Link href={`/glory-home/manuals/${man.id}`} className="font-medium hover:underline">
                      {[man.code, man.title].filter(Boolean).join(" · ") || (man.plannedMonth ? `Lined up for ${monthLabel(man.plannedMonth)}` : "Lined up")}
                    </Link>
                    <span className="block text-muted">
                      {[man.saturday ? formatDate(man.saturday) : null, man.parts && man.parts > 1 ? `Part ${man.part} of ${man.parts}` : null, man.number || man.saturday ? STAGE_LABEL[man.stage as Stage] : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {user.role !== "VIEWER" && freeSaturday && (
              <Link href={`/glory-home?m=${freeSaturday.slice(0, 7)}&plan=${freeSaturday}&message=${m.id}`} className="btn-quiet self-start">
                Plan a manual from this message
              </Link>
            )}
          </section>

          {reviewer && !m.needsDetails && (
            <details className="card p-6">
              <summary className="cursor-pointer font-display text-lg font-semibold">Edit details</summary>
              <div className="mt-4">
                <DetailsForm
                  messageId={m.id}
                  initial={{ title: m.title, date: isoDay(m.date), speaker: m.speaker ?? "", series: m.series ?? "", location: m.location ?? "" }}
                  speakers={speakers}
                  compact
                />
              </div>
              {m.edits.length > 0 && (
                <ul className="mt-5 flex flex-col gap-1.5 border-t border-line pt-4 text-xs text-muted">
                  {m.edits.map((e) => (
                    <li key={e.id}>
                      {e.user?.name ?? "Someone"} changed {Object.keys(e.changes as object).join(", ")} on {formatDate(e.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </aside>
      </div>
    </>
  );
}
