import { makeDate } from "./dates";
import { similarity, titleCore } from "./glory";

// Reads the Glory Home folder as dragged into the portal: which files are manuals, which
// are Members Manuals and which Teacher's Guides, which month they belong to, and which
// two make up one manual. Only paths and names are used, so this runs in the browser.

export type FileKind = "members" | "guide";
export type ClassifiedFile = {
  path: string;
  name: string;
  folder: string;
  kind: FileKind;
  skip: string | null;
  year: number | null;
  month: number | null;
  day: number | null;
  number: number | null;
  title: string;
  core: string;
};

export type ManualGroup = {
  key: string;
  folder: string;
  title: string;
  year: number | null;
  month: number | null;
  day: number | null;
  number: number | null;
  members: ClassifiedFile | null;
  guide: ClassifiedFile | null;
  // Same document twice in a folder ("X.docx" and "X_.docx"): only one is uploaded.
  duplicates: ClassifiedFile[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1 || null;

// Folders and files that aren't Glory Home manuals.
const SKIP: [RegExp, string][] = [
  [/(^|\/)cac(\/|$)/i, "Not a manual (business documents)"],
  [/capstone/i, "Not a manual"],
  [/(^|\/)structure documents(\/|$)/i, "Templates and examples"],
  [/(^|\/)extras(\/|$)/i, "Extras folder"],
  [/the writing team/i, "A writer's draft (the finished copy is filed by month)"],
  [/transcript/i, "A message transcript, not a manual"],
  [/minutes|ideas|improvement log|links\.docx|schedule|master sheet/i, "Not a manual"],
  [/glory home manual x |leaders teaching guide/i, "A blank template or guide for leaders"],
];

function dayMonth(raw: string): { day: number; month: number } | null {
  const text = raw.replace(/_/g, " ");
  // "8th April", "17th Dec", "23rd June", "Aug 31", "June 29", "Dec 7th", "16 March", "27 January"
  const a = new RegExp(`(?:^|[^\\d])(\\d{1,2})(?:st|nd|rd|th|t)?[\\s_-]*(?:of\\s+)?${MONTH_RE}\\b`, "i").exec(text);
  if (a) return { day: Number(a[1]), month: monthOf(a[2])! };
  const b = new RegExp(`\\b${MONTH_RE}[\\s_-]*(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i").exec(text);
  if (b) return { day: Number(b[2]), month: monthOf(b[1])! };
  return null;
}

// The words that say what the manual is, without dates, "Teacher's Guide", numbers.
export function cleanTitle(name: string): string {
  // "God_s" was "God's" before the file was saved; other underscores were spaces or symbols.
  let t = name.replace(/\.(docx?|pdf)$/i, "").replace(/(\w)_s\b/gi, "$1's").replace(/_/g, " ");
  t = t.replace(/^copy of\s+/i, "");
  // A leading date: "8th April- ", "17th Dec-POHA- ", "5th August - ", "25t Nov- "
  t = t.replace(new RegExp(`^\\s*\\d{1,2}(?:st|nd|rd|th|t)?\\s*${MONTH_RE}\\s*[-–:]\\s*`, "i"), "");
  t = t.replace(/\b(poha)\s*[-–]\s*/i, "");
  // A date anywhere else ("TEACHERS MANUAL 27th April").
  t = t.replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s*${MONTH_RE}\\b`, "gi"), " ");
  t = t.replace(/\(?\s*(teacher(?:'?s)?'?|leaders)\s*(teaching\s*)?(guide|manual)\s*\d*\s*\)?/gi, " ");
  t = t.replace(/\(?\s*(member(?:'?s)?'?|student)\s*manual\s*\d*\s*\)?/gi, " ");
  t = t.replace(/\bglory home manual\s*\d*/gi, " ");
  t = t.replace(/\bmaual\b/gi, " ");
  t = t.replace(/\bdraft\b|\bdocx\b/gi, " ");
  t = t.replace(/\(\s*\d*\s*\)/g, " ");
  t = t.replace(/\s*[-–:.']+\s*$/g, "").replace(/^\s*[-–:.']+\s*/g, "");
  t = t.replace(/\s*-\s*'?\s*$/, "").replace(/\s+/g, " ").trim();
  return t;
}

export function classify(path: string): ClassifiedFile {
  const parts = path.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? path;
  const folders = parts.slice(0, -1);
  const folder = folders.join("/");
  let skip: string | null = null;
  if (!/\.(docx?|pdf)$/i.test(name)) skip = "Not a Word or PDF file";
  for (const [re, why] of SKIP) if (!skip && re.test(path)) skip = why;
  if (!skip && folders.length <= 1 && !/\d/.test(folder)) skip = "Loose file at the top of the folder";
  const kind: FileKind = /teacher|leaders.*guide|teaching guide/i.test(name) ? "guide" : "members";

  let year: number | null = null;
  for (const f of folders) {
    const y = /\b(20\d\d)\b/.exec(f);
    if (y) year = Number(y[1]);
  }
  let month: number | null = null;
  let day: number | null = null;
  for (const f of folders) {
    // "11_November_2026": the name wins, as some folders have the wrong number ("07_August").
    const mm = /^(\d{2})\s*_\s*([a-z]+)/i.exec(f);
    if (mm) month = monthOf(mm[2]) ?? Number(mm[1]);
    else {
      const dm = dayMonth(f);
      if (dm) ({ day, month } = dm);
      else {
        const only = new RegExp(`^\\s*${MONTH_RE}\\b`, "i").exec(f);
        if (only) month = monthOf(only[1]);
      }
    }
  }
  const fromName = dayMonth(name);
  if (fromName && (!month || fromName.month === month)) ({ day, month } = fromName);
  // No year in the path ("TO GLORY HOME SECRETARIAT/Feb 17th"): the latest year in which
  // that day was a Saturday, since every manual is for a Saturday.
  if (!year && month && day) {
    const now = new Date();
    for (let y = now.getUTCFullYear(); y >= 2018; y--) {
      const d = makeDate(y, month, day);
      if (d && d.getUTCDay() === 6 && d.getTime() <= now.getTime()) {
        year = y;
        break;
      }
    }
  }
  const num = /(?:manual|guide)\s*(\d{2,3})\b/i.exec(name);
  const title = cleanTitle(name);
  return { path, name, folder, kind, skip, year, month, day, number: num ? Number(num[1]) : null, title, core: titleCore(title) };
}

// Pairs a folder's Members Manuals with their Teacher's Guides.
export function groupFiles(files: ClassifiedFile[]): ManualGroup[] {
  // "Copy of X" next to (or anywhere besides) X is the same manual twice.
  const originals = new Set(files.filter((f) => !f.skip && !/^copy of /i.test(f.name)).map((f) => `${f.kind}:${f.core}`));
  for (const f of files) if (!f.skip && /^copy of /i.test(f.name) && f.core && originals.has(`${f.kind}:${f.core}`)) f.skip = "A copy of another file";
  const byFolder = new Map<string, ClassifiedFile[]>();
  for (const f of files) if (!f.skip) byFolder.set(f.folder, [...(byFolder.get(f.folder) ?? []), f]);
  const out: ManualGroup[] = [];
  for (const [folder, list] of byFolder) {
    const groups: ManualGroup[] = [];
    const make = (f: ClassifiedFile): ManualGroup => ({
      key: `${folder}/${f.core || f.name}`,
      folder,
      title: f.title,
      year: f.year,
      month: f.month,
      day: f.day,
      number: f.number,
      members: null,
      guide: null,
      duplicates: [],
    });
    const place = (g: ManualGroup, f: ClassifiedFile) => {
      const slot = f.kind;
      if (!g[slot]) g[slot] = f;
      else g.duplicates.push(f);
      if (!g.title || (f.kind === "members" && f.title)) g.title = f.title || g.title;
      g.number ??= f.number;
      g.day ??= f.day;
    };
    // Members Manuals first, then each guide joins the closest-titled one.
    for (const f of list.filter((x) => x.kind === "members")) {
      const same = groups.find((g) => g.members && f.core && titleCore(g.members.title) === f.core);
      if (same) place(same, f);
      else {
        const g = make(f);
        place(g, f);
        groups.push(g);
      }
    }
    for (const f of list.filter((x) => x.kind === "guide")) {
      let best: ManualGroup | null = null;
      let score = 0;
      for (const g of groups) {
        if (g.guide && titleCore(g.guide.title) !== f.core) continue;
        const s = g.number && f.number && g.number === f.number ? 1 : similarity(g.title, f.title);
        if (s > score) [best, score] = [g, s];
      }
      // A folder with one Members Manual and one Teacher's Guide is one manual, whatever
      // the files are called ("MEMBERS MANUAL.docx" + "TEACHERS_ GUIDE.docx").
      const pairByFolder = groups.length === 1 && !groups[0].guide && list.filter((x) => x.kind === "guide").length === 1;
      if (best && (score >= 0.5 || pairByFolder || !f.core || !best.members?.core)) place(best, f);
      else if (pairByFolder) place(groups[0], f);
      else {
        const g = make(f);
        place(g, f);
        groups.push(g);
      }
    }
    out.push(...groups);
  }
  return out;
}

export function groupDate(g: { year: number | null; month: number | null; day: number | null }): Date | null {
  if (!g.year || !g.month || !g.day) return null;
  return makeDate(g.year, g.month, g.day);
}
