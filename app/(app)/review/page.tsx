import Link from "next/link";
import { currentUser, canReview } from "@/lib/auth";
import ReviewList from "@/components/ReviewList";
import ActionButton from "@/components/ActionButton";
import AutoRefresh from "@/components/AutoRefresh";
import { retryFailed } from "@/app/actions/messages";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDuration } from "@/lib/dates";
import { PageHeading, Empty } from "@/components/ui";
import { jobLooksStalled } from "@/lib/jobs";

export const metadata = { title: "Review queue" };

export default async function ReviewPage() {
  const user = await currentUser();
  const [toReview, working, failed] = await Promise.all([
    prisma.message.findMany({
      where: { status: { in: ["AI_DRAFT", "IN_REVIEW"] } },
      orderBy: [{ status: "desc" }, { updatedAt: "asc" }],
      select: {
        id: true,
        title: true,
        date: true,
        speaker: true,
        status: true,
        needsDetails: true,
        durationSec: true,
        updatedAt: true,
        transcript: { select: { reviewer: { select: { name: true } } } },
      },
      take: 200,
    }),
    prisma.transcriptionJob.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      orderBy: { createdAt: "asc" },
      include: { message: { select: { id: true, title: true } } },
      take: 100,
    }),
    prisma.transcriptionJob.findMany({
      where: { status: "FAILED", message: { status: "FAILED" } },
      orderBy: { finishedAt: "desc" },
      include: { message: { select: { id: true, title: true } } },
      take: 20,
    }),
  ]);

  return (
    <>
      <PageHeading
        eyebrow="Review queue"
        title="Read, correct, approve."
        lead="AI drafts every transcript. Someone who knows the message checks it against the audio before writers use it."
      />

      <section className="card flex flex-col gap-4 p-6">
        <h2 className="font-display text-2xl font-semibold">Waiting for review</h2>
        {toReview.length === 0 ? (
          <Empty title="Nothing to review">New drafts appear here as soon as the AI finishes them.</Empty>
        ) : (
          <ReviewList
            canApprove={canReview(user.role)}
            rows={toReview.map((m) => ({
              id: m.id,
              title: m.title,
              status: m.status,
              needsDetails: m.needsDetails,
              meta:
                [formatDate(m.date), m.speaker, formatDuration(m.durationSec)].filter(Boolean).join(" · ") +
                (m.status === "IN_REVIEW" && m.transcript?.reviewer ? ` · ${m.transcript.reviewer.name} is on it` : ""),
            }))}
          />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-3 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">Being transcribed</h2>
            {working.length > 0 && <AutoRefresh />}
          </div>
          {working.length === 0 ? (
            <p className="text-sm text-muted">Nothing in the queue. Use Run next batch to start on the backlog.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {working.map((j) => {
                const parts = (j.parts as unknown[] | null)?.length ?? 0;
                // Only a started job can be paused; queued ones are waiting their turn.
                const stalled = j.status === "RUNNING" && jobLooksStalled(j);
                return (
                  <li key={j.id} className="flex flex-col gap-0.5">
                    <div className="flex justify-between gap-3">
                      <Link className="truncate hover:underline" href={`/messages/${j.message.id}`}>{j.message.title}</Link>
                      <span className="shrink-0 text-muted">
                        {j.kind === "TIMINGS" ? "Timings · " : ""}
                        {j.status === "PENDING"
                          ? "Queued"
                          : j.step === "PART"
                            ? `Part ${Math.min(j.nextPart + 1, parts)} of ${parts}`
                            : j.step === "TIME"
                              ? `Timing part ${Math.min(j.nextTime + 1, parts)} of ${parts}`
                              : j.step === "FINISH"
                                ? "Finishing"
                                : "Preparing"}
                      </span>
                    </div>
                    {j.error ? (
                      <span className="text-xs text-alert">Retrying ({j.attempts} of 3) after: {j.error.slice(0, 160)}</span>
                    ) : (
                      stalled && <span className="text-xs text-muted">Paused. Restarting now; this list updates on its own.</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card flex flex-col gap-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">Failed</h2>
            {failed.length > 0 && canReview(user.role) && (
              <ActionButton action={retryFailed} className="btn-quiet h-9 px-3 text-[13px]" pendingLabel="Queueing…">
                Try all again
              </ActionButton>
            )}
          </div>
          {failed.length === 0 ? (
            <p className="text-sm text-muted">No failed transcriptions.</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {failed.map((j) => (
                <li key={j.id}>
                  <Link className="font-medium hover:underline" href={`/messages/${j.message.id}`}>{j.message.title}</Link>
                  <span className="block text-alert">{j.error}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
