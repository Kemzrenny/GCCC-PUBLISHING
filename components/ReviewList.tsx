"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveMany } from "@/app/actions/messages";
import { StatusChip } from "@/components/ui";
import type { TranscriptStatus } from "@prisma/client";

export type ReviewRow = { id: string; title: string; meta: string; status: TranscriptStatus; needsDetails: boolean };

// The review queue with tick boxes, so many drafts can be approved at once.
export default function ReviewList({ rows, canApprove }: { rows: ReviewRow[]; canApprove: boolean }) {
  const router = useRouter();
  const approvable = rows.filter((r) => !r.needsDetails);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const allOn = approvable.length > 0 && approvable.every((r) => picked.has(r.id));

  const approve = (ids: string[]) => {
    if (!ids.length) return;
    if (!window.confirm(`Approve ${ids.length} transcript${ids.length === 1 ? "" : "s"} without opening ${ids.length === 1 ? "it" : "them"}? Writers will use ${ids.length === 1 ? "it" : "them"} as checked.`)) return;
    setResult(null);
    start(async () => {
      const res = await approveMany(ids);
      setResult(res);
      setPicked(new Set());
      router.refresh();
    });
  };

  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  return (
    <div className="flex flex-col gap-3">
      {canApprove && approvable.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-banner px-4 py-3">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              className="size-5 accent-[var(--button)]"
              checked={allOn}
              onChange={() => setPicked(allOn ? new Set() : new Set(approvable.map((r) => r.id)))}
            />
            {picked.size ? `${picked.size} selected` : "Select all"}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary h-10 px-4 text-[13px]" disabled={pending || !picked.size} onClick={() => approve([...picked])}>
              {pending ? "Approving…" : `Approve selected${picked.size ? ` (${picked.size})` : ""}`}
            </button>
            <button type="button" className="btn-quiet h-10 px-4 text-[13px]" disabled={pending} onClick={() => approve(approvable.map((r) => r.id))}>
              Approve all {approvable.length}
            </button>
          </div>
        </div>
      )}
      {result && (
        <p role="status" className={`text-sm ${result.error ? "text-alert" : "text-muted"}`}>
          {result.error ?? result.ok}
        </p>
      )}
      <ul className="flex flex-col">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-4 border-b border-line py-4 last:border-0">
            {canApprove && (
              <input
                type="checkbox"
                aria-label={`Select ${m.title}`}
                className="size-5 shrink-0 accent-[var(--button)] disabled:opacity-30"
                checked={picked.has(m.id)}
                disabled={m.needsDetails || pending}
                title={m.needsDetails ? "Confirm its title and date before approving" : undefined}
                onChange={() => toggle(m.id)}
              />
            )}
            <div className="flex min-w-64 flex-1 flex-col gap-1">
              <Link href={`/messages/${m.id}#transcript`} className="text-[15px] font-medium hover:underline">{m.title}</Link>
              <span className="text-[13px] text-muted">{m.meta}</span>
            </div>
            <StatusChip status={m.status} />
            {m.needsDetails && <span className="text-xs text-alert">Needs details</span>}
            <Link href={`/messages/${m.id}#transcript`} className="btn-quiet">Open</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
