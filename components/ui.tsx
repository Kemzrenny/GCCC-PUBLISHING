import type { TranscriptStatus } from "@prisma/client";
import { STATUS } from "@/lib/status";

const TONES = {
  grey: "bg-[var(--chip-grey-bg)] text-[var(--chip-grey)]",
  slate: "bg-[var(--chip-slate-bg)] text-[var(--chip-slate)]",
  blue: "bg-[var(--chip-blue-bg)] text-[var(--chip-blue)]",
  red: "bg-[var(--chip-red-bg)] text-[var(--chip-red)]",
  green: "bg-[var(--chip-green-bg)] text-[var(--chip-green)]",
} as const;

export function Chip({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap ${TONES[tone]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function StatusChip({ status, needsDetails }: { status: TranscriptStatus; needsDetails?: boolean }) {
  if (needsDetails && status === "NOT_STARTED") return <Chip tone="red">Needs details</Chip>;
  const s = STATUS[status];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export function PageHeading({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-3xl flex-col gap-2.5">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-[-0.01em] sm:text-5xl">{title}</h1>
        {lead && <p className="text-base text-muted">{lead}</p>}
      </div>
      {children}
    </div>
  );
}

export function StatCard({ label, value, note, tone = "muted" }: { label: string; value: string; note: string; tone?: "muted" | "accent" | "alert" }) {
  const noteColour = tone === "accent" ? "text-accent" : tone === "alert" ? "text-alert" : "text-muted";
  return (
    <div className="card flex flex-col gap-3.5 p-6">
      <span className="text-base text-muted">{label}</span>
      <span className="font-display text-[44px] leading-none font-semibold tracking-[-0.01em]">{value}</span>
      <span className={`text-sm ${noteColour}`}>{note}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="font-display text-xl font-semibold">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}
