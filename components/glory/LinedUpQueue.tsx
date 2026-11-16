"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronUp, ChevronDown, GripVertical, X } from "lucide-react";
import { reorderLinedUp, removeLinedUp } from "@/app/actions/glory";
import { useReorder } from "./useReorder";

export type QueueRow = { id: string; title: string; href: string; meta: string };

// The lined-up messages, in the order they'll get Saturdays. Drag a row, or use the arrows,
// to change the order; the cross takes a message off.
export default function LinedUpQueue({ rows, canEdit }: { rows: QueueRow[]; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const save = (items: QueueRow[]) => start(async () => setError((await reorderLinedUp(items.map((x) => x.id)))?.error ?? null));
  const { items, setItems, move, rowProps } = useReorder(rows, save);
  const remove = (id: string) => {
    setItems((list) => list.filter((x) => x.id !== id));
    start(async () => setError((await removeLinedUp(id))?.error ?? null));
  };

  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-col">
        {items.map((r, i) => (
          <li
            key={r.id}
            {...(canEdit ? rowProps(r.id) : {})}
            className="group flex items-center gap-2 border-t border-line py-2 data-[over=true]:border-t-2 data-[over=true]:border-t-accent"
          >
            {canEdit && <GripVertical aria-hidden size={16} className="shrink-0 cursor-grab text-muted" />}
            <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted">{i + 1}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link href={r.href} className="truncate text-sm font-medium hover:underline">
                {r.title}
              </Link>
              <span className="truncate text-xs text-muted">{r.meta}</span>
            </div>
            {canEdit && (
              <div className="flex shrink-0 items-center">
                <button type="button" aria-label={`Move “${r.title}” up`} disabled={i === 0} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink disabled:opacity-30" onClick={() => move(r.id, -1)}>
                  <ChevronUp aria-hidden size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Move “${r.title}” down`}
                  disabled={i === items.length - 1}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink disabled:opacity-30"
                  onClick={() => move(r.id, 1)}
                >
                  <ChevronDown aria-hidden size={16} />
                </button>
                <button type="button" aria-label={`Remove “${r.title}” from the line-up`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-[var(--chip-red-bg)] hover:text-alert" onClick={() => remove(r.id)}>
                  <X aria-hidden size={16} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="text-xs text-alert">{error}</p>}
    </div>
  );
}
