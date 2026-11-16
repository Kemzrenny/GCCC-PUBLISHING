"use client";

import { useState, useTransition } from "react";
import { previewSetParts, setParts } from "@/app/actions/glory";

// "How many manuals does this message make?" The writers answer once they've looked at the
// message; the calendar after it moves to match, shown before anything changes.
export default function PartsControl({
  id,
  parts,
  confirmed,
  urgent,
  compact,
}: {
  id: string;
  parts: number;
  confirmed: boolean;
  // The Monday review is close: show the question in red.
  urgent?: boolean;
  compact?: boolean;
}) {
  const [choice, setChoice] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  const pick = (n: number) => {
    setResult(null);
    setChoice(n);
    if (n === parts) {
      // Same number: just confirming it.
      setPreview(null);
      return;
    }
    setPreview("Working out what moves…");
    start(async () => setPreview((await previewSetParts(id, n)) || "Nothing else moves."));
  };
  const save = () =>
    start(async () => {
      const r = await setParts(id, choice ?? parts);
      setResult(r);
      if (!r?.error) {
        setChoice(null);
        setPreview(null);
      }
    });

  const tone = confirmed ? "border-line" : urgent ? "border-alert/70 bg-[var(--chip-red-bg)]" : "border-[var(--chip-amber)]/40 bg-[var(--chip-amber-bg)]";
  return (
    <div className={`flex flex-col gap-2 rounded-xl border ${tone} ${compact ? "px-3 py-2" : "p-4"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={`parts-${id}`} className={`text-[13px] font-medium ${!confirmed && urgent ? "text-[var(--chip-red)]" : ""}`}>
          {confirmed ? "Manuals from this message" : "How many manuals from this message?"}
        </label>
        <select
          id={`parts-${id}`}
          className="field h-9 w-auto py-0 text-[13px]"
          value={choice ?? (confirmed ? parts : "")}
          disabled={pending}
          onChange={(e) => e.target.value && pick(Number(e.target.value))}
        >
          {!confirmed && <option value="">Not confirmed</option>}
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {choice !== null && (
          <>
            <button type="button" className="btn-primary h-9 px-3 text-[13px]" disabled={pending} onClick={save}>
              {pending ? "Saving…" : choice === parts ? "Confirm" : "Confirm and move"}
            </button>
            <button type="button" className="text-[13px] font-medium text-muted hover:text-ink" onClick={() => (setChoice(null), setPreview(null))}>
              Cancel
            </button>
          </>
        )}
      </div>
      {preview && <p className="text-[13px] text-muted">{preview}</p>}
      {result && <p role="status" className={`text-[13px] ${result.error ? "text-alert" : "text-muted"}`}>{result.error ?? result.ok}</p>}
      {!confirmed && !compact && choice === null && !result && (
        <p className="text-xs text-muted">The writers decide after their first look at the message. Later Saturdays move to fit.</p>
      )}
    </div>
  );
}
