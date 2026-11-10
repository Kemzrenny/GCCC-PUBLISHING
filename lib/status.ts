import type { TranscriptStatus } from "@prisma/client";

// How each transcript status reads and looks. Shared by the server pages and the
// client components.

export const STATUS: Record<TranscriptStatus, { label: string; tone: "grey" | "slate" | "blue" | "red" | "green" }> = {
  NOT_STARTED: { label: "Not started", tone: "grey" },
  QUEUED: { label: "Queued", tone: "slate" },
  TRANSCRIBING: { label: "Transcribing", tone: "slate" },
  AI_DRAFT: { label: "AI draft", tone: "slate" },
  IN_REVIEW: { label: "In review", tone: "blue" },
  APPROVED: { label: "Approved", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
};

// The library's status tabs. "dates" is about the date, not a transcript status: messages
// still dated by their Podbean upload day, or with no usable title or date.
export const TABS = [
  { key: "all", label: "All" },
  { key: "todo", label: "Not transcribed" },
  { key: "working", label: "In progress" },
  { key: "review", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "dates", label: "Check dates" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export const TAB_STATUSES: Record<Exclude<TabKey, "all" | "dates">, TranscriptStatus[]> = {
  todo: ["NOT_STARTED", "FAILED"],
  working: ["QUEUED", "TRANSCRIBING"],
  review: ["AI_DRAFT", "IN_REVIEW"],
  approved: ["APPROVED"],
};
