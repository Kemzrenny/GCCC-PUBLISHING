import { findDateInText, looksLikeFuture } from "./dates";
import { parseManualNumbers, parseWriters, titleCore, type Stage } from "./glory";

// Reads the MASTER SHEET tab of the Glory Home schedule. Rows are typed by hand, so:
//  - a row can hold two manuals ("MANUAL 165\nMANUAL 166", topics on separate lines);
//  - a follow-on manual leaves the sermon blank ("PART 2"), meaning the row above's sermon;
//  - a row with a writer and a sermon but no manual number is a message lined up for a month.

export type Cell = { text: string; link: string | null; date?: Date | null };

export type SheetManual = {
  key: string;
  number: number | null;
  topic: string | null;
  saturday: Date | null;
  stage: Stage;
  membersWriter: string | null;
  guideWriter: string | null;
  plannedMonth: string | null;
  part: number | null;
  parts: number | null;
  sermon: { title: string | null; date: Date | null; link: string | null; minister: string | null; session: string | null };
  membersLink: string | null;
  guideLink: string | null;
  notes: string | null;
};

const HEADERS = {
  date: ["date of sermon"],
  session: ["sermon day", "session"],
  title: ["sermon title"],
  link: ["link to sermon"],
  minister: ["minister"],
  writer: ["writer"],
  code: ["manual code"],
  topic: ["manual topic"],
  members: ["manual link"],
  guide: ["teachers guide link", "teacher"],
  update: ["update"],
  status: ["status"],
  release: ["release date"],
} as const;

type Col = keyof typeof HEADERS;

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
const PART_ONLY = /^\(?\s*(part|breakdown|break down)\s*\d+\s*\)?$/i;

function cellDate(c: Cell | undefined, now: Date): Date | null {
  if (!c) return null;
  if (c.date) return new Date(Date.UTC(c.date.getUTCFullYear(), c.date.getUTCMonth(), c.date.getUTCDate()));
  const d = findDateInText(c.text.replace(/(\d)(st|nd|rd|th)\b/gi, "$1"))?.date ?? findDateInText(c.text)?.date ?? null;
  return d && !looksLikeFuture(d, new Date(now.getTime() + 400 * 86_400_000)) ? d : null;
}

function linkOf(c: Cell | undefined): string | null {
  if (!c) return null;
  if (c.link && isUrl(c.link)) return c.link.trim();
  return isUrl(c.text) ? c.text.trim() : null;
}

export function readMasterSheet(rows: Cell[][], now = new Date()): SheetManual[] {
  const headerAt = rows.findIndex((r) => r.some((c) => /manual code/i.test(c.text)));
  if (headerAt < 0) throw new Error("This doesn't look like the Glory Home MASTER SHEET: there's no “MANUAL CODE” column.");
  const header = rows[headerAt].map((c) => c.text.toLowerCase().trim());
  const col = {} as Record<Col, number>;
  for (const [k, names] of Object.entries(HEADERS) as [Col, readonly string[]][]) {
    col[k] = header.findIndex((h, i) => names.some((n) => h.includes(n)) && !Object.values(col).includes(i));
  }
  const get = (r: Cell[], k: Col) => (col[k] >= 0 ? r[col[k]] : undefined);
  const text = (r: Cell[], k: Col) => get(r, k)?.text.trim() ?? "";

  const out: SheetManual[] = [];
  let prev: SheetManual["sermon"] | null = null;
  let prevWriter = "";
  // Writers' months ("Shola(April)") are in this year; the sheet starts 2026 at a marked row.
  let sectionYear: number | null = null;
  // The latest Saturday's year so far, for lined-up rows with no date of their own.
  let lastYear: number | null = null;

  rows.slice(headerAt + 1).forEach((r, i) => {
    const joined = r.map((c) => c.text).join(" ");
    const marker = /schedule from .*?(\d{4})/i.exec(joined);
    if (marker && !text(r, "code")) {
      // "FROM 27TH DECEMBER 2025": the months after it belong to 2026.
      sectionYear = Number(marker[1]) + (/december/i.test(joined) ? 1 : 0);
      return;
    }
    if (!r.some((c) => c.text.trim() || c.link)) return;

    const writerRaw = text(r, "writer");
    let link = linkOf(get(r, "link"));
    let title = text(r, "title") || null;
    if (title && (PART_ONLY.test(title) || /={2,}/.test(title))) title = null;
    let sermon: SheetManual["sermon"] = {
      title,
      date: cellDate(get(r, "date"), now),
      link,
      minister: text(r, "minister") || null,
      session: text(r, "session") || null,
    };
    // A follow-on row: no sermon of its own, same (or no) writer as the row above.
    const sameWriter = !writerRaw || titleCore(writerRaw.replace(/\(.*?\)/g, "")) === titleCore(prevWriter.replace(/\(.*?\)/g, ""));
    if (prev && !link && !sermon.title && sameWriter) sermon = { ...prev };
    else if (prev && link && link === prev.link && !sermon.title) sermon = { ...prev, ...Object.fromEntries(Object.entries(sermon).filter(([, v]) => v)) };
    link = sermon.link;

    const numbers = parseManualNumbers(text(r, "code"));
    const topics = text(r, "topic").split(/\n+/).map((t) => t.trim()).filter(Boolean);
    const w = parseWriters(writerRaw || prevWriter);
    const status = text(r, "status").toUpperCase();
    const saturday = cellDate(get(r, "release"), now);
    if (saturday) lastYear = Math.max(lastYear ?? 0, saturday.getUTCFullYear());
    const membersLink = linkOf(get(r, "members"));
    const guideLink = linkOf(get(r, "guide"));
    const update = text(r, "update") || null;

    if (numbers.length) {
      numbers.forEach((n, k) => {
        const single = numbers.length === 1;
        const past = saturday ? saturday.getTime() < now.getTime() - 86_400_000 : false;
        const stage: Stage =
          status.includes("TAUGHT") || (past && (status.includes("DONE") || !status))
            ? "TAUGHT"
            : status.includes("DONE")
              ? saturday
                ? "SENT"
                : "REVIEWED"
              : membersLink || guideLink
                ? "WRITING"
                : "PLANNED";
        out.push({
          key: `sheet:${n}`,
          number: n,
          topic: topics[k] ?? (single ? topics.join(" ") || null : null),
          // "MANUAL 165 / MANUAL 166" on one row: the second is the Saturday after.
          saturday: saturday ? new Date(saturday.getTime() + k * 7 * 86_400_000) : null,
          stage,
          membersWriter: w.members,
          guideWriter: w.guide,
          plannedMonth: null,
          part: null,
          parts: null,
          sermon,
          membersLink: single ? membersLink : null,
          guideLink: single ? guideLink : null,
          notes: update,
        });
      });
    } else if (writerRaw && (sermon.link || sermon.title)) {
      // Lined up for a team's month, not written yet.
      const mi = w.month;
      // A writer's month is the next time that month comes round after the sermon.
      let year = sectionYear ?? sermon.date?.getUTCFullYear() ?? lastYear ?? now.getUTCFullYear();
      if (!sectionYear && sermon.date && mi && mi < sermon.date.getUTCMonth() + 1) year++;
      out.push({
        key: `sheet-lined:${titleCore(sermon.link ?? sermon.title)}:${titleCore(writerRaw)}`,
        number: null,
        topic: null,
        saturday: null,
        stage: "PLANNED",
        membersWriter: w.members,
        guideWriter: w.guide,
        plannedMonth: mi ? `${year}-${String(mi).padStart(2, "0")}` : null,
        part: null,
        parts: null,
        sermon,
        membersLink: null,
        guideLink: null,
        notes: update,
      });
    }
    // A row with no sermon breaks the chain: the rows after it can't borrow an older one.
    prev = sermon.link || sermon.title ? sermon : null;
    if (writerRaw) prevWriter = writerRaw;
    void i;
  });

  // One sermon, several manuals: number them as parts in manual order.
  const bySermon = new Map<string, SheetManual[]>();
  for (const m of out) {
    if (!m.number) continue;
    const k = m.sermon.link ?? titleCore(m.sermon.title);
    if (!k) continue;
    bySermon.set(k, [...(bySermon.get(k) ?? []), m]);
  }
  for (const group of bySermon.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).forEach((m, i) => {
      m.part = i + 1;
      m.parts = group.length;
    });
  }
  // Keys must be unique: a sheet can list the same lined-up message twice.
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)));
}

