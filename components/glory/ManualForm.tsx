"use client";

import { useActionState } from "react";
import { saveManual } from "@/app/actions/glory";
import type { ActionResult } from "@/app/actions/messages";
import { STAGES, STAGE_LABEL } from "@/lib/glory";

type Values = {
  title: string;
  number: string;
  saturday: string;
  plannedMonth: string;
  stage: string;
  part: string;
  parts: string;
  membersWriter: string;
  guideWriter: string;
  membersUrl: string;
  guideUrl: string;
  notes: string;
};

export default function ManualForm({ id, values, ownMembers, ownGuide, writers }: { id: string; values: Values; ownMembers: boolean; ownGuide: boolean; writers: string[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveManual.bind(null, id), null);
  const field = (name: keyof Values, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`mf-${name}`} className="label">{label}</label>
      <input id={`mf-${name}`} name={name} defaultValue={values[name]} className="field" {...props} />
    </div>
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <datalist id="mf-writers">
        {writers.map((w) => (
          <option key={w} value={w} />
        ))}
      </datalist>
      {field("title", "Topic")}
      <div className="grid gap-4 sm:grid-cols-3">
        {field("number", "Manual number", { inputMode: "numeric", placeholder: "e.g. 195" })}
        {field("saturday", "Saturday", { type: "date" })}
        <div>
          <label htmlFor="mf-stage" className="label">Stage</label>
          <select id="mf-stage" name="stage" defaultValue={values.stage} className="field">
            {STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {field("part", "Part", { inputMode: "numeric" })}
        {field("parts", "Of", { inputMode: "numeric" })}
        {field("membersWriter", "Members Manual by", { list: "mf-writers" })}
        {field("guideWriter", "Teacher’s Guide by", { list: "mf-writers" })}
      </div>
      {!values.saturday && field("plannedMonth", "Lined up for (YYYY-MM)", { placeholder: "2026-12" })}
      {(!ownMembers || !ownGuide) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {!ownMembers && field("membersUrl", "Members Manual link (an older copy)", { type: "url", placeholder: "https://docs.google.com/…" })}
          {!ownGuide && field("guideUrl", "Teacher’s Guide link (an older copy)", { type: "url", placeholder: "https://docs.google.com/…" })}
        </div>
      )}
      <div>
        <label htmlFor="mf-notes" className="label">Notes</label>
        <textarea id="mf-notes" name="notes" defaultValue={values.notes} rows={3} className="field h-auto py-3" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        {state && (
          <span role="status" className={`text-sm ${state.error ? "text-alert" : "text-muted"}`}>
            {state.error ?? state.ok}
          </span>
        )}
      </div>
    </form>
  );
}
