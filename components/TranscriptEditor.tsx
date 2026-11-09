"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { saveTranscript, approveTranscript, reopenTranscript, type ActionResult } from "@/app/actions/messages";

type Props = {
  messageId: string;
  text: string;
  approved: boolean;
  canEdit: boolean;
  needsDetails: boolean;
};

// The reviewer's view: the transcript as one editable text, with Save (keep working) and
// Approve (done). Every save is kept as a version, so nothing typed is ever lost.
export default function TranscriptEditor({ messageId, text, approved, canEdit, needsDetails }: Props) {
  const [value, setValue] = useState(text);
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, start] = useTransition();
  const dirty = value !== text;
  const area = useRef<HTMLTextAreaElement>(null);
  // Read-only until the page is interactive, so nothing typed in the first moment is lost.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const run = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));

  if (!canEdit || approved) {
    return (
      <div className="flex flex-col gap-4">
        <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-field/40 p-5 text-[15px] leading-7 whitespace-pre-wrap">{text}</div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>{words.toLocaleString()} words</span>
          {canEdit && approved && (
            <button type="button" className="btn-quiet" disabled={pending} onClick={() => run(() => reopenTranscript(messageId))}>
              Reopen for edits
            </button>
          )}
          {result && <span role="status" className={result.error ? "text-alert" : ""}>{result.error ?? result.ok}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor="transcript" className="sr-only">Transcript</label>
      <textarea
        id="transcript"
        ref={area}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck
        readOnly={!ready}
        className="min-h-[60vh] w-full resize-y rounded-xl border border-line bg-field/40 p-5 text-[15px] leading-7 text-ink focus:border-accent focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-quiet" disabled={pending || !dirty} onClick={() => run(() => saveTranscript(messageId, value))}>
          {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || needsDetails}
          title={needsDetails ? "Confirm the title and date first" : undefined}
          onClick={() => {
            if (window.confirm("Approve this transcript? Writers will be able to use it.")) run(() => approveTranscript(messageId, value));
          }}
        >
          Approve transcript
        </button>
        <span className="text-sm text-muted">{words.toLocaleString()} words</span>
        {needsDetails && <span className="text-sm text-alert">Confirm the title and date above before approving.</span>}
        {result && (
          <span role="status" className={`text-sm ${result.error ? "text-alert" : "text-muted"}`}>
            {result.error ?? result.ok}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">
        Listen along and correct names, scripture references and anything marked [?]. Keep the preacher’s words: fix mistakes, don’t rewrite.
      </p>
    </div>
  );
}
