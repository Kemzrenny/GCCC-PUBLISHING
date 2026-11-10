"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { merge, notASpeaker } from "@/app/actions/speakers";
import type { ActionResult } from "@/app/actions/messages";

type Name = { name: string; count: number };

function Result({ r }: { r: ActionResult }) {
  if (!r) return null;
  return (
    <span role="status" className={`text-sm ${r.error ? "text-alert" : "text-accent"}`}>
      {r.error ?? r.ok}
    </span>
  );
}

const libraryHref = (name: string) => `/library?speaker=${encodeURIComponent(name)}`;

// One suggested group: tick the spellings that are this person, pick the name to keep.
export function GroupCard({ suggested, names }: { suggested: string; names: Name[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(names.map((n) => n.name)));
  const [keep, setKeep] = useState(suggested);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, start] = useTransition();
  const total = names.filter((n) => picked.has(n.name)).reduce((t, n) => t + n.count, 0);
  const id = `keep-${suggested.replace(/\W+/g, "-")}`;

  return (
    <section className="card flex flex-col gap-4 p-5">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-sm text-muted">Tick the names that are the same person</legend>
        {names.map((n) => (
          <label key={n.name} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-field/60">
            <input
              type="checkbox"
              className="size-5 accent-[var(--button)]"
              checked={picked.has(n.name)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(n.name);
                else next.delete(n.name);
                setPicked(next);
              }}
            />
            <span className="flex-1">{n.name}</span>
            <Link href={libraryHref(n.name)} className="text-sm text-muted hover:underline">
              {n.count} message{n.count === 1 ? "" : "s"}
            </Link>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="label" htmlFor={id}>File them all under</label>
          <input id={id} className="field" value={keep} onChange={(e) => setKeep(e.target.value)} list="speaker-names" />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || picked.size < 1 || !keep.trim() || (picked.size === 1 && picked.has(keep.trim()))}
          onClick={() => start(async () => setResult(await merge(keep, [...picked])))}
        >
          {pending ? "Merging…" : `Merge ${total} message${total === 1 ? "" : "s"}`}
        </button>
      </div>
      <Result r={result} />
    </section>
  );
}

// One row of the full list: rename (or merge into another name), or mark "not a speaker".
export function SpeakerRow({ name, count }: Name) {
  const [value, setValue] = useState(name);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, start] = useTransition();
  const changed = value.trim() && value.trim() !== name;
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`sp-${name}`}>Name for {name}</label>
        <input id={`sp-${name}`} className="field h-10 max-w-md min-w-56 flex-1" value={value} onChange={(e) => setValue(e.target.value)} list="speaker-names" />
        <Link href={libraryHref(name)} className="w-28 text-sm text-muted hover:underline">
          {count} message{count === 1 ? "" : "s"}
        </Link>
        <button type="button" className="btn-primary h-10" disabled={pending || !changed} onClick={() => start(async () => setResult(await merge(value, [name])))}>
          Save
        </button>
        <button
          type="button"
          className="btn-quiet h-10"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Remove “${name}” as a speaker from ${count} message${count === 1 ? "" : "s"}?`)) start(async () => setResult(await notASpeaker(name)));
          }}
        >
          Not a speaker
        </button>
      </div>
      <Result r={result} />
    </li>
  );
}
