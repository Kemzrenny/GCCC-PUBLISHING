"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { classify, groupFiles, type ClassifiedFile, type ManualGroup } from "@/lib/glory-files";

type Outcome = { key: string; ok: boolean; text: string; matched?: boolean };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (g: ManualGroup) => [g.day, g.month ? MONTHS[g.month - 1] : null, g.year].filter(Boolean).join(" ") || "No date";

// Step 2: the Glory Home folder from someone's computer. The browser works out which files
// are manuals and pairs them; each manual's documents are then sent one manual at a time.
export default function FolderImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [classified, setClassified] = useState<ClassifiedFile[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Outcome[]>([]);
  const [stopNote, setStopNote] = useState<string | null>(null);

  const groups = useMemo(() => groupFiles(classified), [classified]);
  const skipped = classified.filter((f) => f.skip);
  const chosen = groups.filter((g) => !excluded.has(g.key));
  // Failed ones are tried again on "Carry on".
  const finished = new Set(done.filter((d) => d.ok).map((d) => d.key));

  const pick = (list: FileList | null) => {
    if (!list) return;
    const map = new Map<string, File>();
    const out: ClassifiedFile[] = [];
    for (const f of Array.from(list)) {
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      map.set(path, f);
      out.push(classify(path));
    }
    setFiles(map);
    setClassified(out);
    setExcluded(new Set());
    setDone([]);
    setStopNote(null);
  };

  const send = async (g: ManualGroup): Promise<Outcome> => {
    const body = new FormData();
    body.set("meta", JSON.stringify({ key: g.key, title: g.title, year: g.year, month: g.month, day: g.day, number: g.number, folder: g.folder }));
    if (g.members) body.set("members", files.get(g.members.path)!);
    if (g.guide) body.set("guide", files.get(g.guide.path)!);
    try {
      const res = await fetch("/api/glory/files", { method: "POST", body });
      const json = (await res.json()) as { error?: string; reconnect?: boolean; label?: string; matched?: boolean; uploaded?: number; kept?: number };
      if (!res.ok || json.error) {
        if (json.reconnect) throw new Error(json.error);
        return { key: g.key, ok: false, text: `${g.title || g.folder}: ${json.error}` };
      }
      return { key: g.key, ok: true, matched: json.matched, text: `${json.label}: ${json.uploaded ? `${json.uploaded} document${json.uploaded === 1 ? "" : "s"} filed` : "already had its documents"}${json.matched ? "" : " (new manual)"}` };
    } catch (err) {
      if (err instanceof Error && err.message) throw err;
      return { key: g.key, ok: false, text: `${g.title || g.folder}: didn't go through` };
    }
  };

  const run = async () => {
    setRunning(true);
    setStopNote(null);
    const queue = chosen.filter((g) => !finished.has(g.key));
    try {
      // Three at a time: quick, without upsetting Drive.
      const worker = async () => {
        for (let g = queue.shift(); g; g = queue.shift()) {
          const r = await send(g);
          setDone((d) => [...d.filter((x) => x.key !== r.key), r]);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } catch (err) {
      setStopNote(err instanceof Error ? err.message : "Stopped.");
    }
    setRunning(false);
    router.refresh();
  };

  const toggle = (key: string) => setExcluded((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));
  const failed = done.filter((d) => !d.ok);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-quiet h-11" disabled={running} onClick={() => input.current?.click()}>
          {classified.length ? "Choose a different folder" : "Choose the Glory Home folder"}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => pick(e.target.files)}
        />
        {classified.length > 0 && (
          <span className="text-[13px] text-muted">
            {classified.length} files: <strong className="text-ink">{groups.length} manuals</strong> ({groups.filter((g) => g.members && g.guide).length} with both documents), {skipped.length} set aside
          </span>
        )}
      </div>

      {classified.length > 0 && (
        <>
          <details className="rounded-xl border border-line px-4 py-3 text-[13px]">
            <summary className="cursor-pointer font-medium">Check the {groups.length} manuals found (untick any to leave out)</summary>
            <ul className="mt-3 flex max-h-96 flex-col overflow-y-auto">
              {groups.map((g) => (
                <li key={g.key} className="flex items-start gap-3 border-t border-line py-2">
                  <input type="checkbox" aria-label={`Include ${g.title || g.folder}`} className="mt-0.5 size-4 accent-[var(--button)]" checked={!excluded.has(g.key)} onChange={() => toggle(g.key)} disabled={running} />
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {g.number ? `MANUAL ${g.number} · ` : ""}
                      {g.title || <span className="text-muted">Untitled ({g.folder.split("/").pop()})</span>}
                    </span>
                    <span className="text-muted">
                      {when(g)} · {[g.members && "Members Manual", g.guide && "Teacher’s Guide"].filter(Boolean).join(" + ")}
                      {g.duplicates.length ? ` · ${g.duplicates.length} duplicate left out` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
          {skipped.length > 0 && (
            <details className="rounded-xl border border-line px-4 py-3 text-[13px]">
              <summary className="cursor-pointer font-medium">{skipped.length} files set aside (not manuals)</summary>
              <ul className="mt-3 flex max-h-72 flex-col overflow-y-auto text-muted">
                {skipped.map((f) => (
                  <li key={f.path} className="border-t border-line py-1.5">
                    <span className="text-ink">{f.name}</span> · {f.skip}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary h-11" disabled={running || !chosen.length} onClick={run}>
              {running ? `Filing… ${done.length} of ${chosen.length}` : done.length ? `Carry on (${chosen.length - done.filter((d) => d.ok).length} left)` : `File ${chosen.length} manuals in the Glory Home folder`}
            </button>
            {(running || done.length > 0) && (
              <div role="img" aria-label={`${done.length} of ${chosen.length} done`} className="h-1.5 min-w-40 flex-1 rounded-full bg-track">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.round((done.length / Math.max(1, chosen.length)) * 100)}%` }} />
              </div>
            )}
          </div>
          {stopNote && (
            <p role="alert" className="text-[13px] text-alert">
              Stopped: {stopNote}
            </p>
          )}
          {done.length > 0 && !running && (
            <p role="status" className="text-[13px] text-muted">
              {done.filter((d) => d.ok).length} filed ({done.filter((d) => d.ok && d.matched).length} matched to the schedule, {done.filter((d) => d.ok && !d.matched).length} new).
              {failed.length ? ` ${failed.length} didn't go through: ${failed.slice(0, 3).map((f) => f.text).join("; ")}${failed.length > 3 ? "…" : ""}` : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}
