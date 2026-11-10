// Sermon dates are calendar days in Lagos, stored as plain dates. Everything here works
// in UTC on purpose so a date never shifts by a day between server and browser.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "02-09-2026", "2/9/26", "21-06-26" are day-month-year, as on the sheet and Podbean.
export function parseDayMonthYear(input: string): Date | null {
  const m = /^\s*(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})\s*$/.exec(input);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return makeDate(year, month, day);
}

export function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  return d;
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// For <input type="date">.
export function isoDay(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

// The sheet's day-month-year form, for the mirror.
export function sheetDay(d: Date | null | undefined): string {
  if (!d) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// A later date than this in the year is almost certainly a typo (the old sheet has 2028).
export function looksLikeFuture(d: Date, now = new Date()): boolean {
  return d.getTime() > now.getTime() + 2 * 86_400_000;
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// The old sheet assigns work for a month ("October"). It's overdue once that month has
// passed in the current year.
export function monthOverdue(label: string | null | undefined, now = new Date()): boolean {
  if (!label) return false;
  const i = MONTH_NAMES.indexOf(label.trim().toLowerCase());
  return i >= 0 && i < now.getUTCMonth();
}

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = (name: string) => MONTH_NAMES.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3))) + 1;

// A date written anywhere in a title or description: "23-07-2026", "2026-07-23",
// "23rd July 2026", "July 23, 2026", "Sun 23 Jul 26". Returns the text it matched, so it
// can be taken out of a title.
export function findDateInText(text: string): { date: Date; match: string } | null {
  const tries: [RegExp, (m: RegExpExecArray) => Date | null][] = [
    [/(?<![\d])(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?![\d])/, (m) => makeDate(Number(m[1]), Number(m[2]), Number(m[3]))],
    [/(?<![\d])(\d{1,2}[-./]\d{1,2}[-./](?:\d{4}|\d{2}))(?![\d])/, (m) => parseDayMonthYear(m[1])],
    [
      new RegExp(`(?<![\\w])(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?[\\s,.-]+${MONTH_RE}\\.?[\\s,.-]+(\\d{4}|\\d{2})(?![\\d])`, "i"),
      (m) => makeDate(year(m[3]), monthIndex(m[2]), Number(m[1])),
    ],
    [
      new RegExp(`(?<![\\w])${MONTH_RE}\\.?[\\s,.-]+(\\d{1,2})(?:st|nd|rd|th)?[\\s,.-]+(\\d{4}|\\d{2})(?![\\d])`, "i"),
      (m) => makeDate(year(m[3]), monthIndex(m[1]), Number(m[2])),
    ],
  ];
  for (const [re, read] of tries) {
    const m = re.exec(text);
    if (!m) continue;
    const date = read(m);
    if (date) return { date, match: m[0] };
  }
  return null;
}

function year(y: string) {
  const n = Number(y);
  return n < 100 ? n + 2000 : n;
}

// The calendar day in Lagos (UTC+1) of a moment, as a stored date.
export function lagosDay(moment: Date): Date {
  const t = new Date(moment.getTime() + 3_600_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}
