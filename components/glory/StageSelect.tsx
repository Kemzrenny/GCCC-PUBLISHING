"use client";

import { useState, useTransition } from "react";
import { setStage } from "@/app/actions/glory";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/glory";

// One clear status per manual, changed straight from the list.
export const STAGE_STYLE: Record<Stage, string> = {
  PLANNED: "bg-[var(--chip-grey-bg)] text-[var(--chip-grey)]",
  WRITING: "bg-[var(--chip-amber-bg)] text-[var(--chip-amber)]",
  REVIEWED: "bg-[var(--chip-blue-bg)] text-[var(--chip-blue)]",
  SENT: "bg-[var(--chip-slate-bg)] text-[var(--chip-slate)]",
  TAUGHT: "bg-[var(--chip-green-bg)] text-[var(--chip-green)]",
};

export default function StageSelect({ id, stage, canEdit, label }: { id: string; stage: Stage; canEdit: boolean; label?: string }) {
  const [value, setValue] = useState<Stage>(stage);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return <span className={`inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium ${STAGE_STYLE[value]}`}>{STAGE_LABEL[value]}</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <label className="sr-only" htmlFor={`stage-${id}`}>{label ?? "Status"}</label>
      <select
        id={`stage-${id}`}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Stage;
          const was = value;
          setValue(next);
          setError(null);
          start(async () => {
            const r = await setStage(id, next);
            if (r?.error) {
              setValue(was);
              setError(r.error);
            }
          });
        }}
        className={`h-9 cursor-pointer appearance-none rounded-full border-0 bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8 pl-3.5 text-[13px] font-medium ${STAGE_STYLE[value]}`}
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-alert">{error}</span>}
    </span>
  );
}
