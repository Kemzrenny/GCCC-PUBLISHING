"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveBranches, renameLocation } from "@/app/actions/branches";
import type { BranchRule, Branches } from "@/lib/branches";

const blank = (): BranchRule => ({ name: "", words: [], speaker: "", from: "", to: "" });

// The branches, and how a message is matched to one.
export function BranchesForm({ initial, speakers }: { initial: Branches; speakers: string[] }) {
  const [rows, setRows] = useState(() => initial.branches.map((b) => ({ ...b, wordsText: b.words.join(", ") })));
  const [main, setMain] = useState(initial.main);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = () =>
    start(async () => {
      const branches = rows
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), words: r.wordsText.split(",").map((w) => w.trim()).filter(Boolean), speaker: r.speaker, from: r.from, to: r.to }));
      setResult(await saveBranches({ main: branches.some((b) => b.name === main) ? main : (branches[0]?.name ?? ""), branches }));
    });

  return (
    <div className="flex flex-col gap-4">
      <datalist id="branch-speakers">
        {speakers.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {rows.map((r, i) => (
        <fieldset key={i} className="grid gap-3 rounded-xl border border-line p-4 md:grid-cols-2">
          <legend className="sr-only">Branch {i + 1}</legend>
          <div>
            <label className="label" htmlFor={`b-name-${i}`}>Branch</label>
            <div className="flex items-center gap-2">
              <input id={`b-name-${i}`} className="field" value={r.name} placeholder="e.g. Ojodu" onChange={(e) => set(i, { name: e.target.value })} />
              <button type="button" aria-label={`Remove ${r.name || "this branch"}`} className="btn-quiet h-11 w-11 shrink-0 px-0" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden size={16} />
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="radio" name="main-branch" className="size-4 accent-[var(--button)]" checked={main === r.name && !!r.name} onChange={() => setMain(r.name)} />
              Main branch (anything the rules don’t place)
            </label>
          </div>
          <div>
            <label className="label" htmlFor={`b-words-${i}`}>Words in the Podbean title or description</label>
            <input id={`b-words-${i}`} className="field" value={r.wordsText} placeholder="e.g. Abuja, FCT" onChange={(e) => set(i, { wordsText: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <span className="label">Or: a speaker’s messages between two dates (optional)</span>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
              <input aria-label="Speaker" className="field" list="branch-speakers" value={r.speaker} placeholder="Any speaker" onChange={(e) => set(i, { speaker: e.target.value })} />
              <input aria-label="From" type="date" className="field" value={r.from} onChange={(e) => set(i, { from: e.target.value })} />
              <input aria-label="To" type="date" className="field" value={r.to} onChange={(e) => set(i, { to: e.target.value })} />
            </div>
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-quiet gap-1.5" onClick={() => setRows((r) => [...r, { ...blank(), wordsText: "" }])}>
          <Plus aria-hidden size={16} /> Add a branch
        </button>
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save branches"}
        </button>
        {result && <span role="status" className={`text-sm ${result.error ? "text-alert" : "text-muted"}`}>{result.error ?? result.ok}</span>}
      </div>
    </div>
  );
}

// One place name as it appears on messages, and the branch to call it.
export function LocationRow({ value, count, branches }: { value: string; count: number; branches: string[] }) {
  const [to, setTo] = useState(branches.includes(value) ? value : "");
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line py-3 text-sm last:border-0">
      <span className="min-w-48 flex-1">
        {value || <span className="text-muted">No branch</span>} <span className="text-muted">· {count.toLocaleString()}</span>
      </span>
      {branches.includes(value) ? (
        <span className="text-[13px] text-[var(--chip-green)]">A branch</span>
      ) : (
        <>
          <label className="sr-only" htmlFor={`loc-${value}`}>Branch for {value || "messages with none"}</label>
          <select id={`loc-${value}`} className="field h-9 w-auto" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Call it…</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button type="button" className="btn-quiet h-9" disabled={!to || pending} onClick={() => start(async () => setResult(await renameLocation(value, to)))}>
            {pending ? "Saving…" : "Apply"}
          </button>
        </>
      )}
      {result && <span className={`w-full text-[13px] ${result.error ? "text-alert" : "text-muted"}`}>{result.error ?? result.ok}</span>}
    </li>
  );
}
