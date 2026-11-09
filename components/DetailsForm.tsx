"use client";

import { useActionState } from "react";
import { saveDetails, type ActionResult } from "@/app/actions/messages";

type Props = {
  messageId: string;
  initial: { title: string; date: string; speaker: string; series: string; location: string };
  suggestedTitle?: string | null;
  podbeanTitle?: string | null;
  speakers: string[];
  compact?: boolean;
};

export default function DetailsForm({ messageId, initial, suggestedTitle, podbeanTitle, speakers, compact }: Props) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveDetails.bind(null, messageId), null);
  const listId = `speakers-${messageId}`;
  return (
    <form action={action} className="flex flex-col gap-4">
      {podbeanTitle && (
        <p className="text-sm text-muted">
          On Podbean: <span className="text-ink">“{podbeanTitle}”</span>
        </p>
      )}
      <div className={`grid gap-4 ${compact ? "sm:grid-cols-[2fr_1fr]" : "sm:grid-cols-2"}`}>
        <div className={compact ? "" : "sm:col-span-2"}>
          <label className="label" htmlFor={`title-${messageId}`}>Title</label>
          <input className="field" id={`title-${messageId}`} name="title" defaultValue={initial.title || suggestedTitle || ""} required />
          {suggestedTitle && !initial.title && <p className="mt-1.5 text-xs text-muted">Suggested from the transcript. Check it before saving.</p>}
        </div>
        <div>
          <label className="label" htmlFor={`date-${messageId}`}>Date preached</label>
          <input className="field" id={`date-${messageId}`} name="date" type="date" defaultValue={initial.date} required />
        </div>
        <div>
          <label className="label" htmlFor={`speaker-${messageId}`}>Speaker</label>
          <input className="field" id={`speaker-${messageId}`} name="speaker" list={listId} defaultValue={initial.speaker} />
          <datalist id={listId}>
            {speakers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label" htmlFor={`series-${messageId}`}>Series</label>
          <input className="field" id={`series-${messageId}`} name="series" defaultValue={initial.series} />
        </div>
        <div className={compact ? "" : "sm:col-span-2"}>
          <label className="label" htmlFor={`location-${messageId}`}>Location</label>
          <input className="field" id={`location-${messageId}`} name="location" defaultValue={initial.location} placeholder="Ojodu, Lagos, Nigeria" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save details"}</button>
        {state && <span role="status" className={`text-sm ${state.error ? "text-alert" : "text-muted"}`}>{state.error ?? state.ok}</span>}
      </div>
    </form>
  );
}
