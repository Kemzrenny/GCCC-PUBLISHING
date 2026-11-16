import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mic } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import ActionButton from "@/components/ActionButton";
import ManualForm from "@/components/glory/ManualForm";
import MatchMessage from "@/components/glory/MatchMessage";
import { TONE_TEXT, TONE_DOT, DocIcon } from "@/components/glory/bits";
import StageSelect from "@/components/glory/StageSelect";
import PartsControl from "@/components/glory/PartsControl";
import { makeDocs, linkManualMessage, deleteManual, outlineMessage, checkProgress } from "@/app/actions/glory";
import { manualCode, nextStep, monthLabel, writingProgress, partsUrgent, type Stage } from "@/lib/glory";
import type { MessageSection } from "@/lib/gemini";
import { formatDate, isoDay } from "@/lib/dates";
import { STATUS } from "@/lib/status";

export const metadata = { title: "Manual" };

export default async function ManualPage({ params }: PageProps<"/glory-home/manuals/[id]">) {
  const user = await currentUser();
  const canEdit = user.role !== "VIEWER";
  const { id } = await params;
  const m = await prisma.manual.findUnique({
    where: { id },
    include: { message: { select: { id: true, title: true, date: true, speaker: true, status: true, location: true, sections: true, transcript: { select: { driveUrl: true } } } } },
  });
  if (!m) notFound();
  const [templates, writers, siblings] = await Promise.all([
    getSettings(["gloryTemplateMembers", "gloryTemplateGuide"]),
    prisma.$queryRaw<{ w: string }[]>`SELECT DISTINCT w FROM (SELECT "membersWriter" AS w FROM "Manual" UNION SELECT "guideWriter" FROM "Manual") x WHERE w IS NOT NULL ORDER BY w`,
    m.messageId ? prisma.manual.findMany({ where: { messageId: m.messageId, NOT: { id: m.id } }, orderBy: [{ saturday: "asc" }], select: { id: true, number: true, title: true, saturday: true } }) : [],
  ]);
  const stage = m.stage as Stage;
  const lined = !m.saturday && !m.number;
  const step = nextStep(stage, m.saturday);
  const progress = writingProgress(m);
  const sections = (m.message?.sections as MessageSection[] | null) ?? null;
  const transcribed = m.message && m.message.status !== "NOT_STARTED" && m.message.status !== "FAILED" && m.message.status !== "TRANSCRIBING";
  const templatesReady = !!(templates.gloryTemplateMembers && templates.gloryTemplateGuide);

  return (
    <>
      <Link href={lined ? "/glory-home/manuals?show=lined" : "/glory-home/manuals"} className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink">
        <ArrowLeft aria-hidden size={16} /> All manuals
      </Link>
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{lined ? `Lined up${m.plannedMonth ? ` for ${monthLabel(m.plannedMonth)}` : ""}` : (manualCode(m.number) ?? "Glory Home manual")}</span>
        <h1 className="font-display text-4xl leading-[1.05] font-semibold sm:text-5xl">{lined ? (m.message?.title ?? m.sourceTitle ?? "A sermon") : m.title || "Topic not set yet"}</h1>
        <p className="text-base text-muted">
          {[m.saturday ? `Saturday ${formatDate(m.saturday)}` : null, m.parts && m.parts > 1 ? `Part ${m.part} of ${m.parts}` : null, [m.membersWriter, m.guideWriter !== m.membersWriter ? m.guideWriter : null].filter(Boolean).join(" & ") || null]
            .filter(Boolean)
            .join(" · ") || "No Saturday yet"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {!lined && (
            <section className="card flex flex-col gap-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1 text-sm">
                  <span className={`inline-flex items-center gap-1.5 font-medium ${TONE_TEXT[step.tone]}`}>
                    <span aria-hidden className={`size-2 rounded-full ${TONE_DOT[step.tone]}`} />
                    {step.label}
                  </span>
                  <span className="text-[13px] text-muted">
                    Writing: <span className={progress.started ? "text-[var(--chip-green)]" : ""}>{progress.label}</span>
                    {(m.membersDocId || m.guideDocId) && canEdit && (
                      <>
                        {" · "}
                        <ActionButton action={checkProgress.bind(null, [m.id])} className="inline font-medium text-accent hover:underline" pendingLabel="Checking…" inlineResult={false}>
                          check now
                        </ActionButton>
                      </>
                    )}
                  </span>
                </div>
                <StageSelect id={m.id} stage={stage} canEdit={canEdit} />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                {m.membersUrl ? (
                  <a href={m.membersUrl} target="_blank" rel="noreferrer" className="btn-quiet h-10 gap-1.5 px-3.5 text-[13px]">
                    <DocIcon /> Members Manual{!m.membersDocId && " (older copy)"}
                  </a>
                ) : null}
                {m.guideUrl ? (
                  <a href={m.guideUrl} target="_blank" rel="noreferrer" className="btn-quiet h-10 gap-1.5 px-3.5 text-[13px]">
                    <DocIcon /> Teacher’s Guide{!m.guideDocId && " (older copy)"}
                  </a>
                ) : null}
                {canEdit && (!m.membersDocId || !m.guideDocId) && (
                  templatesReady ? (
                    <ActionButton action={makeDocs.bind(null, m.id)} className="btn-quiet h-10 px-3.5 text-[13px]" pendingLabel="Making documents…">
                      {m.membersDocId || m.guideDocId ? "Create the missing document" : "Create documents from the templates"}
                    </ActionButton>
                  ) : (
                    <span className="text-[13px] text-muted">Upload the templates in Settings to create documents here.</span>
                  )
                )}
              </div>
            </section>
          )}

          {!lined && m.messageId && m.saturday && (m.partsConfirmed || stage === "PLANNED" || stage === "WRITING") && (
            <section className="card flex flex-col gap-4 p-6">
              <h2 className="font-display text-xl font-semibold">How many manuals?</h2>
              {canEdit ? (
                <PartsControl id={m.id} parts={m.parts ?? 1} confirmed={m.partsConfirmed} urgent={partsUrgent(m.saturday)} />
              ) : (
                <p className="text-sm">{m.partsConfirmed ? `${m.parts ?? 1} manual${(m.parts ?? 1) === 1 ? "" : "s"} from this message.` : "Not confirmed yet."}</p>
              )}
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">To help decide: the message’s main sections</h3>
                {sections ? (
                  <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
                    {sections.map((x, i) => (
                      <li key={i}>
                        <span className="font-medium">{x.heading}</span>
                        <span className="text-muted"> · {x.gist}</span>
                        {x.scriptures?.length ? <span className="block text-xs text-muted">{x.scriptures.join(", ")}</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : transcribed ? (
                  canEdit && (
                    <div>
                      <ActionButton action={outlineMessage.bind(null, m.messageId)} pendingLabel="Reading the transcript…">
                        List the main sections
                      </ActionButton>
                    </div>
                  )
                ) : (
                  <p className="text-[13px] text-muted">Available once the message is transcribed.</p>
                )}
                <p className="text-xs text-muted">Drafted by AI from the transcript, as a starting point. The writers decide how the message is divided.</p>
              </div>
            </section>
          )}

          {canEdit ? (
            <section className="card flex flex-col gap-4 p-6">
              <h2 className="font-display text-xl font-semibold">Details</h2>
              <ManualForm
                id={m.id}
                ownMembers={!!m.membersDocId}
                ownGuide={!!m.guideDocId}
                writers={writers.map((w) => w.w)}
                values={{
                  title: m.title ?? "",
                  number: m.number ? String(m.number) : "",
                  saturday: isoDay(m.saturday),
                  plannedMonth: m.plannedMonth ?? "",
                  membersWriter: m.membersWriter ?? "",
                  guideWriter: m.guideWriter ?? "",
                  membersUrl: m.membersDocId ? "" : (m.membersUrl ?? ""),
                  guideUrl: m.guideDocId ? "" : (m.guideUrl ?? ""),
                  notes: m.notes ?? "",
                }}
              />
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          <section id="message" className="card flex flex-col gap-3 p-6">
            <h2 className="font-display text-lg font-semibold">From the message</h2>
            {m.message ? (
              <>
                <div className="flex items-start gap-2.5">
                  <Mic aria-hidden size={18} className="mt-0.5 shrink-0 text-muted" />
                  <div className="flex flex-col gap-0.5">
                    <Link href={`/messages/${m.message.id}`} className="font-medium hover:underline">{m.message.title}</Link>
                    <span className="text-[13px] text-muted">{[formatDate(m.message.date), m.message.speaker, m.message.location, STATUS[m.message.status].label].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
                {m.message.transcript?.driveUrl && (
                  <a href={m.message.transcript.driveUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-accent hover:underline">
                    Transcript in Google Docs
                  </a>
                )}
                {canEdit && (
                  <ActionButton action={linkManualMessage.bind(null, m.id, null)} className="self-start text-[13px] font-medium text-muted hover:text-ink" pendingLabel="Unlinking…">
                    Not this message
                  </ActionButton>
                )}
              </>
            ) : (
              <>
                {m.sourceTitle || m.sourceLink ? (
                  <p className="text-[13px] text-muted">
                    The schedule says: <span className="text-ink">{m.sourceTitle ?? "a sermon"}</span>
                    {m.sourceLink && (
                      <>
                        {" · "}
                        <a href={m.sourceLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">listen</a>
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-[13px] text-muted">Not linked to a message yet.</p>
                )}
                {canEdit && <MatchMessage manualId={m.id} initial={m.sourceTitle ?? ""} />}
              </>
            )}
            {siblings.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
                <span className="font-medium">Also from this message</span>
                {siblings.map((s) => (
                  <Link key={s.id} href={`/glory-home/manuals/${s.id}`} className="text-muted hover:text-ink">
                    {[manualCode(s.number), s.title, s.saturday ? formatDate(s.saturday) : null].filter(Boolean).join(" · ") || "Lined up"}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {m.notes && !canEdit && (
            <section className="card p-6 text-sm">
              <h2 className="mb-2 font-display text-lg font-semibold">Notes</h2>
              {m.notes}
            </section>
          )}

          {(user.role === "ADMIN" || user.role === "REVIEWER") && (
            <section className="card flex flex-col gap-2 p-6">
              <h2 className="font-display text-lg font-semibold">Remove</h2>
              <p className="text-[13px] text-muted">Takes it off the calendar and the lists. Its documents stay in the Glory Home folder.</p>
              <ActionButton action={deleteManual.bind(null, m.id)} className="btn-danger self-start" confirm="Remove this manual from the portal?" pendingLabel="Removing…">
                Remove this {lined ? "lined-up message" : "manual"}
              </ActionButton>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
