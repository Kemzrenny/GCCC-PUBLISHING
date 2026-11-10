"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchMessages, linkManualMessage, type MessagePick } from "@/app/actions/glory";
import { formatDate } from "@/lib/dates";

// Finds the message a manual came from and links it.
export default function MatchMessage({ manualId, initial }: { manualId: string; initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<MessagePick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => searchMessages(q).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="match-q" className="label">Find the message</label>
      <div className="relative">
        <Search aria-hidden size={18} className="absolute top-3.5 left-3.5 text-muted" />
        <input id="match-q" type="search" className="field pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or speaker" autoComplete="off" />
      </div>
      {results.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-line">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{r.title}</span>
                <span className="text-xs text-muted">{[formatDate(r.date), r.speaker].filter(Boolean).join(" · ")}</span>
              </div>
              <button
                type="button"
                className="btn-quiet h-9 shrink-0 px-3 text-[13px]"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await linkManualMessage(manualId, r.id);
                    if (res?.error) setError(res.error);
                    else router.refresh();
                  })
                }
              >
                This one
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}
    </div>
  );
}
