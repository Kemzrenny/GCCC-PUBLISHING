"use client";

import { useActionState, useState, useTransition } from "react";
import type { Role } from "@prisma/client";
import { importSheet, saveSettings, inviteMember, removeInvite, updateMember } from "@/app/actions/admin";
import type { ActionResult } from "@/app/actions/messages";

function Result({ state }: { state: ActionResult }) {
  if (!state) return null;
  return (
    <span role="status" className={`text-sm ${state.error ? "text-alert" : "text-muted"}`}>
      {state.error ?? state.ok}
    </span>
  );
}

export function ImportForm() {
  const [state, action, pending] = useActionState<(ActionResult & { problems?: string[] }) | null, FormData>(importSheet, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Open the Publishing Central Content System sheet.</li>
        <li>Go to the tab with the messages, then File › Download › Comma-separated values (.csv).</li>
        <li>Choose that file here. Importing again later updates rows instead of duplicating them.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="csv">Sheet CSV file</label>
        <input id="csv" name="file" type="file" accept=".csv,text/csv" required className="text-sm file:mr-3 file:h-11 file:rounded-[10px] file:border file:border-line file:bg-card file:px-4 file:text-sm file:font-semibold file:text-ink" />
        <button className="btn-primary" disabled={pending}>{pending ? "Importing… this can take a minute" : "Import"}</button>
      </div>
      <Result state={state} />
      {state?.problems && state.problems.length > 0 && (
        <details className="rounded-xl bg-field/50 p-4 text-sm">
          <summary className="cursor-pointer font-medium">{state.problems.length} rows to check</summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-muted">
            {state.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}

type Provider = { key: string; label: string; ready: boolean };

export function TranscriptionSettings({
  values,
  providers,
  speakers,
}: {
  values: { transcribeProvider: string; batchSize: string; batchOrder: string; batchSpeaker: string; autoTranscribeNew: string; manualsWritten: string };
  providers: Provider[];
  // Speakers with messages still to transcribe, and how many.
  speakers: { name: string; ready: number }[];
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveSettings, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="provider">Transcription service</label>
        <select id="provider" name="transcribeProvider" className="field" defaultValue={values.transcribeProvider}>
          {providers.map((p) => (
            <option key={p.key} value={p.key} disabled={!p.ready}>
              {p.label}{p.ready ? "" : " (no API key)"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="batchSize">Messages per batch</label>
        <input id="batchSize" name="batchSize" type="number" min={1} max={50} className="field" defaultValue={values.batchSize} />
      </div>
      <div>
        <label className="label" htmlFor="batchOrder">Work through the backlog</label>
        <select id="batchOrder" name="batchOrder" className="field" defaultValue={values.batchOrder}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="batchSpeaker">Batches take messages by</label>
        <select id="batchSpeaker" name="batchSpeaker" className="field" defaultValue={values.batchSpeaker}>
          <option value="">Every speaker</option>
          {values.batchSpeaker && !speakers.some((s) => s.name === values.batchSpeaker) && <option value={values.batchSpeaker}>{values.batchSpeaker} (all done)</option>}
          {speakers.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.ready.toLocaleString()} to do)
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="manualsWritten">Glory Home manuals written so far</label>
        <input id="manualsWritten" name="manualsWritten" type="number" min={0} className="field" defaultValue={values.manualsWritten} />
      </div>
      <label className="flex items-center gap-3 text-sm sm:col-span-2">
        <input type="checkbox" name="autoTranscribeNew" defaultChecked={values.autoTranscribeNew === "1"} className="size-5 accent-[var(--button)]" />
        Transcribe new Podbean messages automatically
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

const ROLES: { key: Role; label: string; hint: string }[] = [
  { key: "ADMIN", label: "Admin", hint: "Everything, including team and settings" },
  { key: "REVIEWER", label: "Reviewer", hint: "Edits and approves transcripts, fixes details" },
  { key: "WRITER", label: "Writer", hint: "Reads everything" },
  { key: "VIEWER", label: "Viewer", hint: "Reads everything" },
];

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(inviteMember, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">
        <label className="label" htmlFor="invite-email">Email</label>
        <input id="invite-email" name="email" type="email" required className="field" placeholder="name@example.com" />
      </div>
      <div>
        <label className="label" htmlFor="invite-role">Role</label>
        <select id="invite-role" name="role" className="field w-auto" defaultValue="REVIEWER">
          {ROLES.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </div>
      <button className="btn-primary" disabled={pending}>{pending ? "Inviting…" : "Invite"}</button>
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function InviteRow({ email, role }: { email: string; role: Role }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 text-sm last:border-0">
      <span>{email} <span className="text-muted">· invited as {ROLES.find((r) => r.key === role)?.label}</span></span>
      <button type="button" className="btn-quiet h-9" disabled={pending} onClick={() => start(async () => void (await removeInvite(email)))}>
        Remove
      </button>
    </li>
  );
}

export function MemberRow({ id, name, email, role, disabled, isMe }: { id: string; name: string; email: string; role: Role; disabled: boolean; isMe: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>(null);
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line py-3 text-sm last:border-0">
      <span className="min-w-56 flex-1">
        <span className="font-medium">{name}</span> <span className="text-muted">{email}</span>
        {disabled && <span className="ml-2 text-alert">Turned off</span>}
      </span>
      <label className="sr-only" htmlFor={`role-${id}`}>Role for {name}</label>
      <select
        id={`role-${id}`}
        className="field h-9 w-auto"
        defaultValue={role}
        disabled={isMe || pending}
        onChange={(e) => start(async () => setResult(await updateMember(id, { role: e.target.value as Role })))}
      >
        {ROLES.map((r) => (
          <option key={r.key} value={r.key}>{r.label}</option>
        ))}
      </select>
      {!isMe && (
        <button
          type="button"
          className={disabled ? "btn-quiet h-9" : "btn-danger h-9"}
          disabled={pending}
          onClick={() => start(async () => setResult(await updateMember(id, { disabled: !disabled })))}
        >
          {disabled ? "Turn back on" : "Turn off"}
        </button>
      )}
      {result?.error && <span className="text-alert">{result.error}</span>}
    </li>
  );
}
