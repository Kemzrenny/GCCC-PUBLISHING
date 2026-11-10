import Link from "next/link";
import { Mic } from "lucide-react";
import ActionButton from "@/components/ActionButton";
import { advanceManual, makeDocs } from "@/app/actions/glory";
import { STAGE_LABEL, ADVANCE_LABEL, STAGES, nextStep, manualCode, type Stage } from "@/lib/glory";
import { formatDate } from "@/lib/dates";
import { STATUS } from "@/lib/status";
import type { ManualWithMessage } from "@/lib/glory-data";
import { StageBar, TONE_TEXT, TONE_DOT, DocIcon } from "./bits";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DayBlock({ date, tone }: { date: Date; tone: "past" | "next" | "soon" | "empty" | "plain" }) {
  const cls = {
    past: "bg-field text-muted",
    next: "bg-button text-white",
    soon: "bg-banner text-ink",
    empty: "bg-[var(--chip-red-bg)] text-[var(--chip-red)]",
    plain: "bg-banner text-ink",
  }[tone];
  return (
    <div className={`flex h-[76px] w-[72px] shrink-0 flex-col items-center justify-center rounded-xl ${cls}`}>
      <span className="text-xs font-semibold tracking-[0.06em]">{DAYS[date.getUTCDay()].toUpperCase()}</span>
      <span className="font-display text-[28px] leading-none font-semibold">{date.getUTCDate()}</span>
      <span className="text-xs">{MONTHS[date.getUTCMonth()]}</span>
    </div>
  );
}

export default function ManualCard({ m, dayTone, canEdit }: { m: ManualWithMessage; dayTone: "past" | "next" | "soon" | "plain"; canEdit: boolean }) {
  const stage = m.stage as Stage;
  const step = nextStep(stage, m.saturday);
  const advance = ADVANCE_LABEL[stage];
  const writers = [m.membersWriter && `Members Manual: ${m.membersWriter}`, m.guideWriter && `Teacher’s Guide: ${m.guideWriter}`].filter(Boolean).join(" · ");
  const hasDocs = m.membersUrl || m.guideUrl;
  return (
    <article className="card flex flex-wrap gap-5 p-5 sm:px-6">
      {m.saturday && <DayBlock date={m.saturday} tone={dayTone} />}
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold tracking-[0.06em] text-accent">{manualCode(m.number) ?? "No number yet"}</span>
          <Link href={`/glory-home/manuals/${m.id}`} className="font-display text-xl font-semibold hover:underline">
            {m.title || <span className="text-muted">Topic not set yet</span>}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted">
          <Mic aria-hidden size={15} />
          {m.message ? (
            <>
              <Link href={`/messages/${m.message.id}`} className="font-medium text-ink hover:underline">{m.message.title}</Link>
              <span>{[formatDate(m.message.date), m.message.speaker].filter(Boolean).join(" · ")}</span>
              {m.message.status !== "APPROVED" && <span>· {m.message.status === "NOT_STARTED" || m.message.status === "FAILED" ? "Not transcribed" : STATUS[m.message.status].label}</span>}
            </>
          ) : (
            <span className="text-alert">{m.sourceTitle ? `“${m.sourceTitle}” isn’t matched to a message yet` : "No message linked"}</span>
          )}
          {m.parts && m.parts > 1 && (
            <span className="rounded-full bg-[var(--chip-blue-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--chip-blue)]">
              Part {m.part} of {m.parts}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <StageBar stage={stage} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
            <span>
              <span className="font-semibold">{STAGE_LABEL[stage]}</span>
              <span className="text-muted"> · step {STAGES.indexOf(stage) + 1} of 5</span>
            </span>
            <span className={`inline-flex items-center gap-1.5 font-medium ${TONE_TEXT[step.tone]}`}>
              <span aria-hidden className={`size-2 rounded-full ${TONE_DOT[step.tone]}`} />
              {step.label}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
          <span className="text-[13px] text-muted">{writers || "Writers not set"}</span>
          <div className="flex flex-wrap items-center gap-2">
            {m.membersUrl && (
              <a href={m.membersUrl} target="_blank" rel="noreferrer" className="btn-quiet h-10 gap-1.5 px-3.5 text-[13px]">
                <DocIcon /> Members Manual
              </a>
            )}
            {m.guideUrl && (
              <a href={m.guideUrl} target="_blank" rel="noreferrer" className="btn-quiet h-10 gap-1.5 px-3.5 text-[13px]">
                <DocIcon /> Teacher’s Guide
              </a>
            )}
            {canEdit && !hasDocs && stage !== "TAUGHT" && (
              <ActionButton action={makeDocs.bind(null, m.id)} className="btn-quiet h-10 px-3.5 text-[13px]" pendingLabel="Making documents…">
                Create documents
              </ActionButton>
            )}
            {canEdit && advance && (
              <ActionButton action={advanceManual.bind(null, m.id)} className="btn-primary h-10 px-3.5 text-[13px]" pendingLabel="Saving…">
                {advance}
              </ActionButton>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
