"use client";

import { useState, useTransition } from "react";
import { saveGlorySettings } from "@/app/actions/glory";
import { addMonths, monthLabel, teamFor, type Rotation, type Team } from "@/lib/glory";

// The writing teams (with emails, so the Glory Home folder can be shared with them) and
// which team has which month.
export default function TeamsForm({ teams: initial, rotation, thisMonth }: { teams: Team[]; rotation: Rotation; thisMonth: string }) {
  const [teams, setTeams] = useState<Team[]>(() => initial.map((t) => ({ ...t, members: [...t.members, { name: "", email: "" }] })));
  const [current, setCurrent] = useState(() => teamFor(thisMonth, initial, rotation)?.id ?? initial[0]?.id ?? "");
  const [overrides, setOverrides] = useState<Record<string, string>>(rotation.overrides);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  const months = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i));
  // Alternating from this month's team, before any month is changed by hand.
  const auto = (key: string) => teamFor(key, teams, { anchorMonth: thisMonth, anchorTeam: current, overrides: {} });
  const setMember = (ti: number, mi: number, field: "name" | "email", value: string) =>
    setTeams((ts) =>
      ts.map((t, i) => {
        if (i !== ti) return t;
        const members = t.members.map((m, j) => (j === mi ? { ...m, [field]: value } : m));
        // Always one empty row to add another person.
        if (members[members.length - 1].name || members[members.length - 1].email) members.push({ name: "", email: "" });
        return { ...t, members };
      }),
    );

  const save = () =>
    start(async () => {
      setResult(
        await saveGlorySettings({
          teams: teams.map((t) => ({ ...t, members: t.members.filter((m) => m.name.trim()) })),
          anchorMonth: thisMonth,
          anchorTeam: current,
          overrides,
        }),
      );
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((t, ti) => (
          <fieldset key={t.id} className="flex flex-col gap-3 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-medium">Team {ti + 1}</legend>
            <div>
              <label className="label" htmlFor={`team-${t.id}`}>Name</label>
              <input id={`team-${t.id}`} className="field" value={t.name} onChange={(e) => setTeams((ts) => ts.map((x, i) => (i === ti ? { ...x, name: e.target.value } : x)))} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="label mb-0">Members (first writes the Members Manual, second the Teacher’s Guide)</span>
              {t.members.map((m, mi) => (
                <div key={mi} className="grid grid-cols-[1fr_1.4fr] gap-2">
                  <input aria-label={`Team ${ti + 1} member ${mi + 1} name`} className="field" placeholder="Name" value={m.name} onChange={(e) => setMember(ti, mi, "name", e.target.value)} />
                  <input aria-label={`Team ${ti + 1} member ${mi + 1} email`} className="field" type="email" placeholder="Gmail, to share the folder" value={m.email} onChange={(e) => setMember(ti, mi, "email", e.target.value)} />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="team-now" className="text-sm font-medium">Writing in {monthLabel(thisMonth)}:</label>
          <select id="team-now" className="field h-11 w-auto" value={current} onChange={(e) => setCurrent(e.target.value)}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <span className="text-[13px] text-muted">Then they take turns each month. Change any month below.</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {months.slice(1).map((k) => (
            <label key={k} className="flex flex-col gap-1 rounded-lg bg-field/50 px-3 py-2 text-[13px]">
              <span className="font-medium">{monthLabel(k)}</span>
              <select
                className="rounded-md bg-card px-2 py-1.5"
                value={overrides[k] ?? ""}
                onChange={(e) => setOverrides((o) => {
                  const next = { ...o };
                  if (e.target.value) next[k] = e.target.value;
                  else delete next[k];
                  return next;
                })}
              >
                <option value="">{auto(k)?.name ?? "—"} (turn)</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save teams"}</button>
        {result && <span role="status" className={`text-sm ${result.error ? "text-alert" : "text-muted"}`}>{result.error ?? result.ok}</span>}
      </div>
    </div>
  );
}
