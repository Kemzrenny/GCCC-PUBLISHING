import { parseDayMonthYear, looksLikeFuture } from "./dates";
import { normaliseSpeaker } from "./podbean-parse";

// Turns the old "Publishing Central Content System" sheet (downloaded as CSV) into rows
// the portal can import. The sheet has a small dashboard above the table, so the header
// row is found by its column names rather than assumed to be first.

export type SheetRow = {
  legacyId: number | null;
  date: Date | null;
  title: string;
  speaker: string | null;
  location: string | null;
  series: string | null;
  sourceUrl: string | null;
  transcribed: boolean;
  transcriptUrl: string | null;
  summary: string | null;
  themes: string[];
  tractPotential: boolean;
  bookPotential: boolean;
  assigneeName: string | null;
  dueLabel: string | null;
  // A date that can't be right (missing, unreadable or in the future) goes to Needs details.
  dateSuspect: boolean;
  manual: { status: string | null; link: string | null; code: string | null; title: string | null; writer: string | null } | null;
  problems: string[];
};

const COLUMNS = {
  id: ["id"],
  date: ["date"],
  title: ["title"],
  speaker: ["speaker"],
  location: ["location"],
  series: ["series"],
  link: ["original message link", "message link", "link"],
  tStatus: ["transcription status"],
  tLink: ["transcription link", "transcript link"],
  summary: ["message summary", "summary"],
  mStatus: ["glory home manual status"],
  mLink: ["glory home manual link"],
  writer: ["writer"],
  mCode: ["manual code"],
  mTopic: ["manual topic"],
  tract: ["tract potential"],
  book: ["book/booklet potential", "book potential"],
  themes: ["related themes", "themes"],
  assigned: ["assigned person", "assigned"],
} as const;

type Col = keyof typeof COLUMNS;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function findHeader(rows: string[][]): { index: number; cols: Partial<Record<Col, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(norm);
    if (!cells.includes("title") || !cells.some((c) => c.includes("link"))) continue;
    const cols: Partial<Record<Col, number>> = {};
    for (const [key, names] of Object.entries(COLUMNS) as [Col, readonly string[]][]) {
      const at = cells.findIndex((c) => names.includes(c));
      if (at >= 0) cols[key] = at;
    }
    return { index: i, cols };
  }
  return null;
}

const clean = (v: string | undefined) => {
  const s = (v ?? "").replace(/​/g, "").replace(/\s+/g, " ").trim();
  return s || null;
};

const yes = (v: string | null) => !!v && /^(yes|y|true|1|x|✓|✔|high|medium)$/i.test(v);

const url = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : null);

// "VICTOR and Hannie(October)" -> name "Victor and Hannie", due "October".
export function splitAssignee(raw: string | null): { name: string | null; due: string | null } {
  if (!raw) return { name: null, due: null };
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(raw);
  const name = (m ? m[1] : raw).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()).trim();
  return { name: name || null, due: m ? m[2].trim() || null : null };
}

export function mapSheet(rows: string[][]): { rows: SheetRow[]; error?: string } {
  const header = findHeader(rows);
  if (!header) return { rows: [], error: "Couldn't find the header row (the one with Title and Original Message Link)." };
  const { index, cols } = header;
  if (cols.title === undefined) return { rows: [], error: "The sheet has no Title column." };
  const get = (r: string[], c: Col) => (cols[c] === undefined ? null : clean(r[cols[c]!]));

  const out: SheetRow[] = [];
  for (const r of rows.slice(index + 1)) {
    const title = get(r, "title");
    if (!title) continue;
    const problems: string[] = [];
    const rawDate = get(r, "date");
    const date = rawDate ? parseDayMonthYear(rawDate) : null;
    if (rawDate && !date) problems.push(`Date "${rawDate}" isn't day-month-year`);
    if (!rawDate) problems.push("No date");
    if (date && looksLikeFuture(date)) problems.push(`Date ${rawDate} is in the future, probably a typo`);
    const idRaw = get(r, "id");
    const legacyId = idRaw && /^\d+$/.test(idRaw) ? Number(idRaw) : null;
    const tLink = url(get(r, "tLink"));
    const tStatus = get(r, "tStatus");
    const transcribed = !!tLink || (!!tStatus && /^(done|complete|completed|transcribed|yes)$/i.test(tStatus));
    const { name, due } = splitAssignee(get(r, "assigned"));
    const mStatus = get(r, "mStatus");
    const mLink = url(get(r, "mLink"));
    const mCode = get(r, "mCode");
    const mTopic = get(r, "mTopic");
    const writer = get(r, "writer");
    const manual = mStatus || mLink || mCode || mTopic ? { status: mStatus, link: mLink, code: mCode, title: mTopic, writer } : null;
    out.push({
      legacyId,
      date,
      title,
      speaker: normaliseSpeaker(get(r, "speaker")),
      location: get(r, "location"),
      series: get(r, "series"),
      sourceUrl: url(get(r, "link")),
      transcribed,
      transcriptUrl: tLink,
      summary: get(r, "summary"),
      themes: (get(r, "themes") ?? "").split(/[,;]/).map((t) => t.trim()).filter(Boolean),
      tractPotential: yes(get(r, "tract")),
      bookPotential: yes(get(r, "book")),
      assigneeName: name,
      dueLabel: due,
      manual,
      dateSuspect: !date || looksLikeFuture(date),
      problems,
    });
  }
  return { rows: out };
}
