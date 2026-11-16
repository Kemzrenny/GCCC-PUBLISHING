"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, TriangleAlert, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { useReorder } from "./useReorder";
import { lineUpNext } from "@/app/actions/glory";

export type LineupRow = {
  id: string;
  title: string;
  date: string | null;
  guessedDate: boolean;
  branch: string | null;
  transcribed: boolean;
  minutes: number | null;
};

const fmt = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "No date");

// Picks up where the last manual left off: the speaker's next messages in the order they
// were preached, ready to line up for a month in one go.
export default function LineUpPanel({
  speaker,
  last,
  next,
  skipped,
  skippedCount,
  closeHref,
}: {
  speaker: string;
  last: { title: string; date: string | null } | null;
  next: LineupRow[];
  skipped: LineupRow[];
  skippedCount: number;
  closeHref: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(next.map((m) => m.id)));
  // The order they'll join the queue in; earlier messages join the end when ticked.
  const { items: order, setItems: setOrder, move, rowProps } = useReorder(next);
  const [transcribe, setTranscribe] = useState(true);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && router.push(closeHref, { scroll: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref]);

  const toggle = (id: string) => setPicked((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const takeEarlier = (m: LineupRow) => {
    setOrder((o) => (o.some((x) => x.id === m.id) ? o : [...o, m]));
    setPicked((s) => new Set(s.add(m.id)));
  };
  const chosen = order.filter((m) => picked.has(m.id));
  const untranscribed = chosen.filter((m) => !m.transcribed).length;
  const submit = () =>
    start(async () => {
      const r = await lineUpNext(chosen.map((m) => m.id), transcribe);
      setResult(r);
      if (!r?.error) {
        router.push(closeHref, { scroll: false });
        router.refresh();
      }
    });

  const details = (m: LineupRow) => (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm font-medium">{m.title}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
        <span className={m.guessedDate ? "inline-flex items-center gap-1 text-[var(--chip-amber)]" : ""}>
          {m.guessedDate && <TriangleAlert aria-hidden size={12} />}
          {fmt(m.date)}
          {m.guessedDate && " (upload day, check it)"}
        </span>
        {m.branch && <span>· {m.branch}</span>}
        {m.minutes && <span>· {m.minutes} min</span>}
        <span>· {m.transcribed ? "Transcribed" : "Not transcribed"}</span>
      </span>
    </span>
  );
  const orderedRow = (m: LineupRow, i: number) => (
    <li key={m.id} {...rowProps(m.id)} className="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0 data-[over=true]:border-t-2 data-[over=true]:border-t-accent">
      <GripVertical aria-hidden size={16} className="shrink-0 cursor-grab text-muted" />
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--button)]" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
        {details(m)}
      </label>
      <div className="flex shrink-0 items-center">
        <button type="button" aria-label={`Move “${m.title}” up`} disabled={i === 0} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink disabled:opacity-30" onClick={() => move(m.id, -1)}>
          <ChevronUp aria-hidden size={16} />
        </button>
        <button type="button" aria-label={`Move “${m.title}” down`} disabled={i === order.length - 1} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink disabled:opacity-30" onClick={() => move(m.id, 1)}>
          <ChevronDown aria-hidden size={16} />
        </button>
      </div>
    </li>
  );
  const row = (m: LineupRow) => (
    <li key={m.id} className="border-b border-line last:border-b-0">
      <label className="flex cursor-pointer items-start gap-3 px-1 py-3">
        <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--button)]" checked={order.some((x) => x.id === m.id) && picked.has(m.id)} onChange={(e) => (e.target.checked ? takeEarlier(m) : toggle(m.id))} />
        {details(m)}
      </label>
    </li>
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-black/25" />
      <div role="dialog" aria-modal="true" aria-labelledby="lineup-title" className="relative flex h-full w-full max-w-[540px] flex-col gap-4 overflow-y-auto border-l border-line bg-card p-6 shadow-[-12px_0_32px_rgba(20,20,22,0.12)] sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-accent">{speaker}</span>
            <h2 id="lineup-title" className="font-display text-[26px] font-semibold">Line up the next messages</h2>
            <p className="text-[13px] text-muted">
              {last ? (
                <>
                  In the order they were preached, after “{last.title}” ({fmt(last.date)}), the last one used for a manual.
                </>
              ) : (
                "In the order they were preached."
              )}
            </p>
          </div>
          <Link href={closeHref} scroll={false} aria-label="Close" className="btn-quiet h-11 w-11 shrink-0 px-0">
            <X aria-hidden size={18} />
          </Link>
        </div>

        {order.length === 0 ? (
          <p className="rounded-xl bg-banner p-4 text-sm">Every message after that is already used or lined up. New ones arrive from Podbean every hour.</p>
        ) : (
          <>
            <p className="-mb-2 text-xs text-muted">Drag or use the arrows to set the order. The top one gets the next free Saturday.</p>
            <ol className="rounded-xl border border-line px-3">{order.map(orderedRow)}</ol>
          </>
        )}

        {skippedCount > 0 && (
          <details className="rounded-xl bg-banner px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              {skippedCount} earlier message{skippedCount === 1 ? " was" : "s were"} never used
            </summary>
            <p className="mt-1 text-xs text-muted">Passed over before “{last?.title}”. Tick any that should still be written: they join the end of the list above.</p>
            <ul className="mt-2 rounded-xl bg-card px-3">{skipped.map(row)}</ul>
            {skippedCount > skipped.length && <p className="mt-2 text-xs text-muted">Showing the {skipped.length} most recent.</p>}
          </details>
        )}

        <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
          <p className="text-[13px] text-muted">They join the end of the lined-up list on the calendar, ready for the next free Saturdays.</p>
          {untranscribed > 0 && (
            <label className="flex items-center gap-2.5 text-[13px]">
              <input type="checkbox" className="size-5 accent-[var(--button)]" checked={transcribe} onChange={(e) => setTranscribe(e.target.checked)} />
              Transcribe the {untranscribed} not transcribed yet, so the writers have the text
            </label>
          )}
          {result?.error && (
            <p role="alert" className="text-sm text-alert">
              {result.error}
            </p>
          )}
          <button type="button" className="btn-primary h-12 text-[15px]" disabled={pending || chosen.length === 0} onClick={submit}>
            {pending ? "Lining up…" : `Line up ${chosen.length} message${chosen.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
