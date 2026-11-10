"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Uploads one of the two templates every new manual is copied from.
export default function TemplateUpload({ kind, label, url }: { kind: "members" | "guide"; label: string; url: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setNote(null);
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    try {
      const res = await fetch("/api/glory/template", { method: "POST", body });
      const json = (await res.json()) as { error?: string };
      setNote(res.ok && !json.error ? { ok: true, text: "Uploaded." } : { ok: false, text: json.error ?? "The upload failed." });
      if (res.ok) router.refresh();
    } catch {
      setNote({ ok: false, text: "The upload didn't go through." });
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
      <div className="flex min-w-48 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[13px] text-muted">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">In the Glory Home folder</a>
          ) : (
            "Not uploaded yet"
          )}
        </span>
      </div>
      <label className="btn-quiet h-10 cursor-pointer px-3.5 text-[13px]">
        {busy ? "Uploading…" : url ? "Replace (.docx)" : "Upload (.docx)"}
        <input
          type="file"
          accept=".docx"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {note && <span role="status" className={`w-full text-[13px] ${note.ok ? "text-muted" : "text-alert"}`}>{note.text}</span>}
    </div>
  );
}
