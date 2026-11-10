"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { planManual, searchMessages, transcribeForManual, type MessagePick } from "@/app/actions/glory";
import { deadlines, shortDay, manualCode } from "@/lib/glory";
import { STATUS } from "@/lib/status";
import { formatDate } from "@/lib/dates";
import type { TranscriptStatus } from "@prisma/client";

type Props = {
  saturday: string;
  label: string;
  teamName: string | null;
  members: string[];
  defaults: { number: number; membersWriter: string | null; guideWriter: string | null };
  preset: MessagePick | null;
  lineUpId: string | null;
  closeHref: string;
  templatesReady: boolean;
  folder: string;
};

// Slides in from the right when a Saturday is being planned.
export default function PlanPanel(p: Props) {
  const router = useRouter();
  const [q, setQ] = useState(p.preset?.title ?? "");
  const [results, setResults] = useState<MessagePick[]>([]);
  const [picked, setPicked] = useState<MessagePick | null>(p.preset);
  const [number, setNumber] = useState(String(p.defaults.number));
  const [part, setPart] = useState("1");
  const [parts, setParts] = useState("1");
  const [title, setTitle] = useState("");
  const [membersWriter, setMembersWriter] = useState(p.defaults.membersWriter ?? "");
  const [guideWriter, setGuideWriter] = useState(p.defaults.guideWriter ?? "");
  const [createDocs, setCreateDocs] = useState(p.templatesReady);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picked) searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && router.push(p.closeHref, { scroll: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, router, p.closeHref]);

  useEffect(() => {
    if (picked || q.trim().length < 2) return;
    const t = setTimeout(() => searchMessages(q).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  const sat = new Date(`${p.saturday}T00:00:00Z`);
  const d = deadlines(sat);
  const nextSat = shortDay(new Date(sat.getTime() + 7 * 86_400_000));
  const notTranscribed = picked && (picked.status === "NOT_STARTED" || picked.status === "FAILED");
  const writers = [...new Set([...p.members, membersWriter, guideWriter].filter(Boolean))];

  const submit = () => {
    setError(null);
    if (!picked) return setError("Pick the message the manual comes from.");
    start(async () => {
      const res = await planManual({
        saturday: p.saturday,
        messageId: picked.id,
        number: Number(number),
        part: Number(part) || 1,
        parts: Number(parts) || 1,
        title,
        membersWriter,
        guideWriter,
        createDocs,
        lineUpId: p.lineUpId ?? undefined,
      });
      if (res.error) setError(res.error);
      else {
        router.push(p.closeHref, { scroll: false });
        router.refresh();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <Link href={p.closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-black/25" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
        className="relative flex h-full w-full max-w-[520px] flex-col gap-4 overflow-y-auto border-l border-line bg-card p-6 shadow-[-12px_0_32px_rgba(20,20,22,0.12)] sm:p-7"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-accent">
              {p.label}
              {p.teamName && ` · ${p.teamName}`}
            </span>
            <h2 id="plan-title" className="font-display text-[26px] font-semibold">Plan a manual</h2>
          </div>
          <Link href={p.closeHref} scroll={false} aria-label="Close" className="btn-quiet h-11 w-11 px-0">
            <X aria-hidden size={18} />
          </Link>
        </div>

        {picked ? (
          <div className="flex flex-col gap-2.5 rounded-xl bg-banner p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{picked.title}</span>
                <span className="text-[13px] text-muted">{[formatDate(picked.date), picked.speaker].filter(Boolean).join(" · ")}</span>
              </div>
              <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => (setPicked(null), setResults([]))}>
                Change
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-muted">● {STATUS[picked.status as TranscriptStatus]?.label ?? picked.status}</span>
              {notTranscribed && picked.audio && !transcribing && (
                <button
                  type="button"
                  className="btn-primary h-9 px-3 text-[13px]"
                  onClick={() => transcribeForManual(picked.id).then((r) => setTranscribing(r?.error ?? r?.ok ?? null))}
                >
                  Transcribe now
                </button>
              )}
            </div>
            {transcribing && <span className="text-xs text-muted">{transcribing}</span>}
            {notTranscribed && !transcribing && (
              <span className="text-xs text-muted">
                {picked.audio ? "Takes about 10 minutes. You can plan the manual now; the transcript will be on the message when it’s ready." : "This message has no Podbean audio to transcribe."}
              </span>
            )}
            <span className="text-xs text-muted">
              {picked.manuals ? `Already used for ${picked.manuals} Glory Home item${picked.manuals === 1 ? "" : "s"}.` : "Not used for Glory Home before."}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="plan-search" className="label">From which message?</label>
            <div className="relative">
              <Search aria-hidden size={18} className="absolute top-3.5 left-3.5 text-muted" />
              <input ref={searchRef} id="plan-search" type="search" className="field pl-10" placeholder="Search by title or speaker" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            </div>
            {results.length > 0 && (
              <ul className="flex flex-col overflow-hidden rounded-xl border border-line">
                {results.map((r) => (
                  <li key={r.id} className="border-b border-line last:border-b-0">
                    <button type="button" className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-field/60" onClick={() => setPicked(r)}>
                      <span className="text-sm font-medium">{r.title}</span>
                      <span className="text-xs text-muted">
                        {[formatDate(r.date), r.speaker, STATUS[r.status as TranscriptStatus]?.label, r.manuals ? `${r.manuals} Glory Home` : null].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="plan-number" className="label">Manual number</label>
            <div className="relative">
              <span className="pointer-events-none absolute top-3 left-3 text-sm text-muted">MANUAL</span>
              <input id="plan-number" className="field pl-[74px]" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div>
            <span className="label">Part</span>
            <div className="flex items-center gap-2">
              <input aria-label="Part" className="field w-14 text-center" inputMode="numeric" value={part} onChange={(e) => setPart(e.target.value.replace(/\D/g, ""))} />
              <span className="text-muted">of</span>
              <input aria-label="Number of parts" className="field w-14 text-center" inputMode="numeric" value={parts} onChange={(e) => setParts(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
        </div>
        {Number(parts) > Number(part) && (
          <p className="-mt-2 text-xs text-muted">
            {Number(parts) - Number(part) === 1
              ? `The other part goes on the next free Saturday from ${nextSat}, as ${manualCode(Number(number) + 1)}.`
              : `The other ${Number(parts) - Number(part)} parts go on the next free Saturdays from ${nextSat}, as ${manualCode(Number(number) + 1)} onwards.`}{" "}
            You can move them.
          </p>
        )}

        <div>
          <label htmlFor="plan-topic" className="label">Topic</label>
          <input id="plan-topic" className="field" placeholder="The manual’s title, e.g. YOU NEED SPIRITUAL SIGHT" value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="mt-1.5 text-xs text-muted">Can be left for the writer to fill in.</p>
        </div>

        <datalist id="plan-writers">
          {writers.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="plan-mm" className="label">Members Manual</label>
            <input id="plan-mm" className="field" list="plan-writers" value={membersWriter} onChange={(e) => setMembersWriter(e.target.value)} />
          </div>
          <div>
            <label htmlFor="plan-tg" className="label">Teacher’s Guide</label>
            <input id="plan-tg" className="field" list="plan-writers" value={guideWriter} onChange={(e) => setGuideWriter(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 rounded-xl border border-line p-4 text-[13px]">
          <span className="font-medium">Deadlines</span>
          <span className="text-muted">
            Draft for review: {shortDay(d.review)}, 8pm
            <br />
            To the secretariat: {shortDay(d.secretariat)}
            <br />
            Taught: {shortDay(sat)}
          </span>
        </div>

        <label className="flex items-start gap-2.5 text-[13px]">
          <input type="checkbox" className="mt-0.5 size-5 accent-[var(--button)]" checked={createDocs} disabled={!p.templatesReady} onChange={(e) => setCreateDocs(e.target.checked)} />
          <span>
            <span className="font-medium">Start both documents from the templates</span>
            <br />
            <span className="text-muted">{p.templatesReady ? `Saved in Glory Home › ${p.folder}, shared with the team.` : "Upload the two templates in Settings first."}</span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-alert">
            {error}
          </p>
        )}
        <button type="button" className="btn-primary mt-auto h-12 text-[15px]" disabled={pending} onClick={submit}>
          {pending ? "Planning…" : `Plan ${manualCode(Number(number)) ?? "the manual"}`}
        </button>
      </div>
    </div>
  );
}
