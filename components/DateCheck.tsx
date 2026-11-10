"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { confirmDates } from "@/app/actions/dates";
import type { CheckGroup } from "@/lib/check-dates";

// The Check dates list: one card per upload day (or per priority group), a play button per
// message, and a date to confirm or change. One audio player is shared by the whole page.
export default function DateCheck({ groups, canEdit }: { groups: CheckGroup[]; canEdit: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const toggle = (id: string, src: string | null) => {
    const el = audio.current;
    if (!el || !src) return;
    if (playing === id) {
      el.pause();
      return;
    }
    el.src = src;
    el.play().then(() => setPlaying(id)).catch(() => setPlaying(null));
  };

  return (
    <>
      <audio ref={audio} preload="none" onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} className="hidden" />
      {groups.map((g) => (
        <Group key={g.key} group={g} canEdit={canEdit} playing={playing} onPlay={toggle} />
      ))}
    </>
  );
}

function Group({
  group,
  canEdit,
  playing,
  onPlay,
}: {
  group: CheckGroup;
  canEdit: boolean;
  playing: string | null;
  onPlay: (id: string, src: string | null) => void;
}) {
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(group.rows.map((r) => [r.id, r.date])));
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(null);
  const [, start] = useTransition();

  const rows = group.rows.filter((r) => !done.has(r.id));
  const edited = rows.filter((r) => dates[r.id] !== r.date);

  const save = (ids: string[], key: string) => {
    setBusy(key);
    setMessage(null);
    start(async () => {
      const res = await confirmDates(ids.map((id) => ({ id, date: dates[id] })));
      setBusy(null);
      if (res?.error) setMessage(res);
      else {
        setDone((d) => new Set([...d, ...ids]));
        if (ids.length > 1) setMessage(res);
      }
    });
  };

  if (!rows.length) {
    return (
      <section className="card flex flex-wrap items-center justify-between gap-2 p-5 text-sm">
        <span className="font-medium">{group.label.replace(/ · .*/, "")}</span>
        <span className="text-muted">{message?.ok ?? "All checked."}</span>
      </section>
    );
  }

  return (
    <section aria-label={group.label} className="card flex flex-col gap-1 p-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold">{group.label}</h2>
          <span className="text-[13px] text-muted">{group.note}</span>
        </div>
        {canEdit && rows.length > 1 && (
          <button
            type="button"
            className={edited.length ? "btn-primary h-11" : "btn-quiet h-11"}
            disabled={!!busy}
            onClick={() => save(rows.map((r) => r.id), "all")}
          >
            {busy === "all" ? "Saving…" : edited.length ? `Save all ${rows.length}` : "All look right"}
          </button>
        )}
      </div>
      {message?.error && (
        <p role="alert" className="pb-2 text-sm text-alert">
          {message.error}
        </p>
      )}
      {rows.map((r) => {
        const changed = dates[r.id] !== r.date;
        return (
          <div key={r.id} className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-3 border-t border-line py-3.5 sm:grid-cols-[44px_minmax(0,1fr)_180px_136px]">
            <button
              type="button"
              className="flex size-11 items-center justify-center rounded-full border border-line bg-card disabled:opacity-40"
              aria-label={playing === r.id ? `Pause ${r.title}` : `Play ${r.title}`}
              disabled={!r.audioUrl}
              title={r.audioUrl ? undefined : "No audio yet"}
              onClick={() => onPlay(r.id, r.audioUrl)}
            >
              {playing === r.id ? <Pause aria-hidden size={16} /> : <Play aria-hidden size={16} className="translate-x-px" />}
            </button>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Link href={`/messages/${r.id}`} className="truncate text-[15px] font-medium hover:underline">
                {r.title}
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                {r.speaker && <span>{r.speaker}</span>}
                {r.tags.map((t) => (
                  <span key={t} className="rounded-full bg-[var(--chip-blue-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--chip-blue)]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {canEdit ? (
              <>
                <label className="col-start-2 sm:col-start-auto">
                  <span className="sr-only">Date preached for {r.title}</span>
                  <input
                    type="date"
                    className={`field h-11 ${changed ? "border-2 border-brand bg-card font-medium" : ""}`}
                    value={dates[r.id]}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDates((d) => ({ ...d, [r.id]: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className={`col-start-2 h-11 sm:col-start-auto ${changed ? "btn-primary" : "btn-quiet"}`}
                  disabled={!!busy || !dates[r.id]}
                  onClick={() => save([r.id], r.id)}
                >
                  {busy === r.id ? "Saving…" : changed ? "Save date" : "Looks right"}
                </button>
              </>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
