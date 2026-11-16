"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { requeueLinedUp, removeLinedUp } from "@/app/actions/glory";
import type { QueueRow } from "./LinedUpQueue";

// Messages given to a team for a month that has passed, with no manual recorded: maybe
// written and not filed, maybe never touched. Put each back in the queue, or take it off.
export default function StaleList({ rows, canEdit }: { rows: QueueRow[]; canEdit: boolean }) {
  const [items, setItems] = useState(rows);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const act = (id: string, action: (id: string) => Promise<{ error?: string } | null>) => {
    setItems((list) => list.filter((x) => x.id !== id));
    start(async () => setError((await action(id))?.error ?? null));
  };
  if (!items.length) return null;
  return (
    <details className="card p-5">
      <summary className="cursor-pointer font-display text-lg font-semibold">Assigned before, no manual recorded ({items.length})</summary>
      <p className="mt-1 text-xs text-muted">Given to a team for a month that has passed. Check with the writers, then put each back in the queue or take it off.</p>
      <ul className="mt-2 flex flex-col">
        {items.map((r) => (
          <li key={r.id} className="flex items-center gap-2 border-t border-line py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link href={r.href} className="truncate text-sm font-medium hover:underline">
                {r.title}
              </Link>
              <span className="truncate text-xs text-muted">{r.meta}</span>
            </div>
            {canEdit && (
              <>
                <button type="button" className="btn-quiet h-8 shrink-0 px-2.5 text-xs" onClick={() => act(r.id, requeueLinedUp)}>
                  To queue
                </button>
                <button type="button" aria-label={`Remove “${r.title}”`} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-[var(--chip-red-bg)] hover:text-alert" onClick={() => act(r.id, removeLinedUp)}>
                  <X aria-hidden size={16} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-alert">{error}</p>}
    </details>
  );
}
