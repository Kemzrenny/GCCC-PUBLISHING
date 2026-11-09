"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions/messages";

// A button that runs a server action and shows what happened next to it.
export default function ActionButton({
  action,
  children,
  className = "btn-quiet",
  confirm,
  pendingLabel = "Working…",
  inlineResult = true,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  pendingLabel?: string;
  inlineResult?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>(null);
  return (
    <span className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setResult(await action()));
        }}
      >
        {pending ? pendingLabel : children}
      </button>
      {inlineResult && result && (
        <span role="status" className={`max-w-xs text-xs ${result.error ? "text-alert" : "text-muted"}`}>
          {result.error ?? result.ok}
        </span>
      )}
    </span>
  );
}
