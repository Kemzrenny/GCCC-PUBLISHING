import { STAGES, STAGE_LABEL, type Stage, type Tone } from "@/lib/glory";

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[var(--chip-green)]",
  done: "text-[var(--chip-green)]",
  soon: "text-[var(--chip-amber)]",
  late: "text-alert",
};
export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-[var(--chip-green)]",
  done: "bg-[var(--chip-green)]",
  soon: "bg-[var(--chip-amber)]",
  late: "bg-alert",
};

// Five slim segments: how far the manual has come.
export function StageBar({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage) + 1;
  const fill = stage === "TAUGHT" ? "bg-[var(--chip-green)]" : "bg-brand";
  return (
    <div role="img" aria-label={`Step ${at} of 5: ${STAGE_LABEL[stage]}`} className="grid grid-cols-5 gap-1">
      {STAGES.map((s, i) => (
        <span key={s} className={`h-1.5 rounded-full ${i < at ? fill : "bg-field"}`} />
      ))}
    </div>
  );
}

export function DocIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </svg>
  );
}
