import Link from "next/link";
import ActionButton from "@/components/ActionButton";
import { makeDocs } from "@/app/actions/glory";
import { nextStep, manualCode, writingProgress, partsUrgent, type Stage } from "@/lib/glory";
import { formatDate } from "@/lib/dates";
import type { ManualWithMessage } from "@/lib/glory-data";
import StageSelect from "./StageSelect";
import PartsControl from "./PartsControl";
import { TONE_TEXT, DocIcon } from "./bits";

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
    <div className={`flex h-[60px] w-[56px] shrink-0 flex-col items-center justify-center rounded-xl ${cls}`}>
      <span className="text-[11px] font-semibold tracking-[0.06em]">{DAYS[date.getUTCDay()].toUpperCase()}</span>
      <span className="font-display text-[22px] leading-none font-semibold">{date.getUTCDate()}</span>
      <span className="text-[11px]">{MONTHS[date.getUTCMonth()]}</span>
    </div>
  );
}

// One Saturday's manual: what it is, where it came from, who's writing, and its status.
export default function ManualCard({ m, dayTone, canEdit }: { m: ManualWithMessage; dayTone: "past" | "next" | "soon" | "plain"; canEdit: boolean }) {
  const stage = m.stage as Stage;
  const step = nextStep(stage, m.saturday);
  const progress = writingProgress(m);
  const writers = [...new Set([m.membersWriter, m.guideWriter].filter(Boolean))].join(" & ");
  const title = m.title || m.message?.title || m.sourceTitle;
  // Once it's reviewed, the split is settled.
  const askParts = !m.partsConfirmed && (stage === "PLANNED" || stage === "WRITING") && !!m.messageId;
  return (
    <article className="card flex gap-4 p-4 sm:px-5">
      {m.saturday && <DayBlock date={m.saturday} tone={dayTone} />}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-semibold tracking-[0.06em] text-accent">
              {manualCode(m.number) ?? "No number yet"}
              {m.parts && m.parts > 1 ? ` · Part ${m.part} of ${m.parts}` : ""}
            </span>
            <Link href={`/glory-home/manuals/${m.id}`} className="font-display text-lg leading-snug font-semibold hover:underline">
              {title || <span className="text-muted">No message yet</span>}
            </Link>
          </div>
          <StageSelect id={m.id} stage={stage} canEdit={canEdit} />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          {m.message && m.title && (
            <>
              <Link href={`/messages/${m.message.id}`} className="hover:text-ink hover:underline">
                From “{m.message.title}”
              </Link>
              <span aria-hidden>·</span>
            </>
          )}
          {m.message && (
            <>
              <span>{[formatDate(m.message.date), m.message.location].filter(Boolean).join(", ")}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {!m.message && <span className="text-alert">Not linked to a message ·</span>}
          <span className="text-ink">{writers || "No writers"}</span>
          <span aria-hidden>·</span>
          <span className={progress.started ? "text-[var(--chip-green)]" : ""}>{progress.label}</span>
        </div>

        {askParts && canEdit && <PartsControl id={m.id} parts={m.parts ?? 1} confirmed={false} urgent={partsUrgent(m.saturday)} compact />}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className={`text-[13px] font-medium ${TONE_TEXT[step.tone]}`}>{step.label.replace(/^Next: /, "")}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {m.membersUrl && (
              <a href={m.membersUrl} target="_blank" rel="noreferrer" className="btn-quiet h-9 gap-1.5 px-3 text-[13px]">
                <DocIcon /> Members
              </a>
            )}
            {m.guideUrl && (
              <a href={m.guideUrl} target="_blank" rel="noreferrer" className="btn-quiet h-9 gap-1.5 px-3 text-[13px]">
                <DocIcon /> Teacher’s Guide
              </a>
            )}
            {canEdit && !m.membersUrl && !m.guideUrl && stage !== "TAUGHT" && (
              <ActionButton action={makeDocs.bind(null, m.id)} className="btn-quiet h-9 px-3 text-[13px]" pendingLabel="Making documents…">
                Create documents
              </ActionButton>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
