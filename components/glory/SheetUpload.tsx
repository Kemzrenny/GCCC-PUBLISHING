"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Result = { manuals: number; created: number; updated: number; matched: number; unmatched: number; linedUp: number; error?: string };

// Step 1: the Glory Home schedule workbook (its MASTER SHEET tab).
export default function SheetUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/glory/sheet", { method: "POST", body });
      const json = (await res.json()) as Result;
      if (!res.ok || json.error) setError(json.error ?? "The upload failed.");
      else {
        setResult(json);
        router.refresh();
      }
    } catch {
      setError("The upload didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="btn-quiet h-11 cursor-pointer self-start">
        {busy ? "Reading the sheet… (up to a few minutes)" : "Choose the schedule (.xlsx)"}
        <input
          type="file"
          accept=".xlsx"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-[13px] text-alert">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="text-[13px] text-muted">
          {result.manuals} manuals and {result.linedUp} lined-up messages read ({result.created} new, {result.updated} updated). {result.matched} matched to a message
          {result.unmatched ? `; ${result.unmatched} still need one` : ""}.
        </p>
      )}
    </div>
  );
}
