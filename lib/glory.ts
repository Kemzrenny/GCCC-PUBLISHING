// Glory Home: the rules, kept free of the database so they can be tested.
// A manual is taught every Saturday. Two teams take a month each in turn. A manual's draft
// is reviewed at the Monday 8pm meeting before its Saturday, sent to the Glory Home
// secretariat by the Tuesday, and taught on the Saturday.

export type TeamMember = { name: string; email: string };
export type Team = { id: string; name: string; members: TeamMember[] };
// Months alternate between the two teams, counting from the anchor month; a month can be
// given to a team by hand.
export type Rotation = { anchorMonth: string; anchorTeam: string; overrides: Record<string, string> };

export const DEFAULT_TEAMS: Team[] = [
  { id: "vh", name: "Victor & Hannie", members: [{ name: "Victor", email: "" }, { name: "Hannie", email: "" }] },
  { id: "sn", name: "Shola & Ndifreke", members: [{ name: "Shola", email: "" }, { name: "Ndifreke", email: "" }] },
];
export const DEFAULT_ROTATION: Rotation = { anchorMonth: "2026-11", anchorTeam: "sn", overrides: {} };

export const STAGES = ["PLANNED", "WRITING", "REVIEWED", "SENT", "TAUGHT"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  PLANNED: "Planned",
  WRITING: "Writing",
  REVIEWED: "Reviewed",
  SENT: "Sent to secretariat",
  TAUGHT: "Taught",
};
// The button that moves a manual on from each stage.
export const ADVANCE_LABEL: Record<Stage, string | null> = {
  PLANNED: "Start writing",
  WRITING: "Mark reviewed",
  REVIEWED: "Mark sent",
  SENT: "Mark taught",
  TAUGHT: null,
};
export const nextStage = (s: Stage): Stage | null => STAGES[STAGES.indexOf(s) + 1] ?? null;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86_400_000;

// ---- Months and Saturdays (dates are UTC midnights, like the database's dates) ----

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const isMonthKey = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthKey(d);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const monthName = (key: string) => MONTHS[Number(key.split("-")[1]) - 1];

export function saturdaysIn(key: string): Date[] {
  const [y, m] = key.split("-").map(Number);
  const out: Date[] = [];
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d = new Date(d.getTime() + DAY)) {
    if (d.getUTCDay() === 6) out.push(d);
  }
  return out;
}

// The Saturday on or after a day.
export function saturdayFrom(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(day.getTime() + ((6 - day.getUTCDay() + 7) % 7) * DAY);
}

export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function teamFor(key: string, teams: Team[], rotation: Rotation): Team | null {
  if (!teams.length) return null;
  const forced = rotation.overrides[key];
  if (forced) return teams.find((t) => t.id === forced) ?? null;
  const start = Math.max(0, teams.findIndex((t) => t.id === rotation.anchorTeam));
  const n = monthsBetween(rotation.anchorMonth, key);
  return teams[(((start + n) % teams.length) + teams.length) % teams.length];
}

// ---- Deadlines ----

// Lagos is UTC+1 all year, so 8pm there is 19:00 UTC.
export function deadlines(saturday: Date) {
  return {
    review: new Date(saturday.getTime() - 5 * DAY + 19 * 3_600_000), // Monday 8pm
    secretariat: new Date(saturday.getTime() - 4 * DAY + 22 * 3_600_000), // end of Tuesday
    taught: new Date(saturday.getTime() + 22 * 3_600_000),
  };
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
export const shortDay = (d: Date) => `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;

function relative(due: Date, now: Date): string {
  // Compare Lagos calendar days.
  const lagos = (t: Date) => Math.floor((t.getTime() + 3_600_000) / DAY);
  const days = lagos(due) - lagos(now);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  if (days === -1) return "1 day late";
  return `${-days} days late`;
}

export type Tone = "ok" | "soon" | "late" | "done";
export type NextStep = { label: string; tone: Tone };

export function nextStep(stage: Stage, saturday: Date | null, now = new Date()): NextStep {
  if (stage === "TAUGHT") return { label: saturday ? `Taught on ${shortDay(saturday)}` : "Taught", tone: "done" };
  if (!saturday) return { label: "No Saturday yet", tone: "soon" };
  const d = deadlines(saturday);
  const [what, due] =
    stage === "PLANNED" || stage === "WRITING"
      ? [`review on ${shortDay(d.review)}, 8pm`, d.review]
      : stage === "REVIEWED"
        ? [`to the secretariat by ${shortDay(d.secretariat)}`, d.secretariat]
        : [`taught on ${shortDay(saturday)}`, d.taught];
  const left = due.getTime() - now.getTime();
  const tone: Tone = left < 0 ? "late" : left < 2 * DAY ? "soon" : "ok";
  return { label: `Next: ${what}, ${relative(due, now)}`, tone };
}

// ---- Reading the master sheet ----

const ALIASES: Record<string, string> = { ndi: "Ndifreke", dami: "Damilola", josh: "Joshua", bigshot: "Gabriel" };

function nameCase(w: string): string {
  const alias = ALIASES[w.toLowerCase()];
  if (alias) return alias;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// "Victor and Hannie(Jan)" → Victor writes the Members Manual, Hannie the Teacher's Guide.
// "SHOLA(Feb)" → Shola writes both.
export function parseWriters(text: string | null | undefined): { members: string | null; guide: string | null; month: number | null } {
  if (!text) return { members: null, guide: null, month: null };
  const monthMatch = /\(([^)]*)\)/.exec(text);
  const month = monthMatch ? monthIndex(monthMatch[1]) : null;
  const names = text
    .replace(/\([^)]*\)/g, " ")
    .split(/\s*(?:\band\b|&|\/|,|\+)\s*/i)
    .map((s) => s.trim().split(/\s+/)[0])
    .filter((s) => s && /^[a-z]/i.test(s))
    .map(nameCase);
  if (!names.length) return { members: null, guide: null, month };
  return { members: names[0], guide: names[1] ?? names[0], month };
}

// "Jan", "January", "Jan-roll over to March", "AUGUST" → 1-12 (the first month named).
export function monthIndex(text: string): number | null {
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i.exec(text);
  if (!m) return null;
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase()) + 1;
}

// "MANUAL 165\nMANUAL 166" → [165, 166].
export function parseManualNumbers(text: string | null | undefined): number[] {
  return [...String(text ?? "").matchAll(/manual\s*(\d{1,4})/gi)].map((m) => Number(m[1]));
}

export const manualCode = (n: number | null | undefined) => (n ? `MANUAL ${n}` : null);

// Lower-case words only, for comparing titles written differently.
export function titleCore(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function similarity(a: string, b: string): number {
  const A = new Set(titleCore(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(titleCore(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}

// The Drive folder for a manual: "2026 Manuals/11_November_2026".
export function folderPath(date: Date | null, fallbackYear?: number | null): string[] {
  if (!date) return [`${fallbackYear ?? "Undated"} Manuals`, "Undated"];
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return [`${y} Manuals`, `${String(m + 1).padStart(2, "0")}_${MONTHS[m]}_${y}`];
}

export function docTitle(kind: "members" | "guide", m: { number: number | null; title: string | null }): string {
  const parts = [manualCode(m.number), m.title?.trim() || null, kind === "members" ? "Members Manual" : "Teacher’s Guide"].filter(Boolean);
  return parts.join(" – ");
}

export function longDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
