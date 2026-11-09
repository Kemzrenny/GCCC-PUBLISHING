import { parseDayMonthYear } from "./dates";

// Reading the GCCC Podbean feed. Episode titles are typed by hand when uploading, so they
// vary: "02-09-2026 Knowing God and Living Out the Kingdom Pastor Olakunle Zakariya",
// "30-08-2026 | Jesus, King of the North | Finale | Pastor Adesola Zakariya", or nothing
// useful at all ("no title or date"). parseEpisodeTitle pulls out what it can and says
// what's missing, so the portal can ask a person instead of guessing.

export type FeedEpisode = {
  guid: string;
  title: string;
  link: string | null;
  audioUrl: string | null;
  pubDate: Date | null;
  durationSec: number | null;
  description: string;
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(item: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = re.exec(item);
  return m ? decodeEntities(m[1]) : null;
}

function attr(item: string, name: string, attribute: string): string | null {
  const re = new RegExp(`<${name}\\s[^>]*${attribute}="([^"]*)"`, "i");
  const m = re.exec(item);
  return m ? decodeEntities(m[1]) : null;
}

export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const parts = v.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function parseFeed(xml: string): FeedEpisode[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return items
    .map((item) => {
      const link = tag(item, "link");
      const guid = tag(item, "guid") ?? link ?? attr(item, "enclosure", "url") ?? "";
      const pub = tag(item, "pubDate");
      const pubDate = pub ? new Date(pub) : null;
      return {
        guid,
        title: tag(item, "title") ?? "",
        link,
        audioUrl: attr(item, "enclosure", "url"),
        pubDate: pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate : null,
        durationSec: parseDuration(tag(item, "itunes:duration")),
        description: (tag(item, "description") ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((e) => e.guid);
}

const TITLES: [RegExp, string][] = [
  [/^(?:pastor|pst\.?|ps\.?)$/i, "Pastor"],
  [/^(?:apostle|aps\.?|apst\.?)$/i, "Apostle"],
  [/^(?:prophet|proph\.?)$/i, "Prophet"],
  [/^(?:reverend|rev\.?)$/i, "Rev."],
  [/^(?:bishop|bp\.?)$/i, "Bishop"],
  [/^(?:evangelist|evang\.?)$/i, "Evangelist"],
  [/^(?:dr\.?|doctor)$/i, "Dr."],
  [/^(?:minister|min\.?)$/i, "Minister"],
];

function normaliseTitle(word: string): string | null {
  for (const [re, out] of TITLES) if (re.test(word)) return out;
  return null;
}

// "Pst. Olakunle Zakariya" and "Pastor Olakunle Zakariya" are the same person; the sheet
// mixes both, so speakers are stored in one form.
export function normaliseSpeaker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const words = raw.replace(/\s+/g, " ").trim().split(" ");
  if (!words[0]) return null;
  const t = normaliseTitle(words[0]);
  const cleaned = words.slice(t ? 1 : 0).map((w) => {
    // "P.K." and "PK" are the same initials.
    if (/^[A-Z]{2}$/.test(w) || /^([A-Z]\.){2,3}$/.test(w)) return w.replace(/\./g, "").split("").join(".") + ".";
    // "OLAWALE" -> "Olawale".
    if (/^[A-Z]{3,}$/.test(w)) return w[0] + w.slice(1).toLowerCase();
    return w;
  });
  const name = cleaned.join(" ").trim();
  if (!name) return null;
  return t ? `${t} ${name}` : name;
}

const SPEAKER_RE =
  /(?:^|[\s|–—\-,:]+)((?:pastor|pst\.?|ps\.|apostle|aps\.?|apst\.?|prophet|reverend|rev\.?|bishop|evangelist|evang\.?|dr\.?|minister)\s+[A-Z][\w.'’-]*(?:\s+[A-Z][\w.'’-]*){0,3})\s*$/i;

const PLACEHOLDER_RE = /\b(no[\s-]?title|no[\s-]?date|untitled|did[\s-]?not[\s-]?put|title[\s-]?here|test)\b/i;

export type ParsedTitle = {
  title: string | null;
  date: Date | null;
  speaker: string | null;
  missing: ("title" | "date")[];
};

export function parseEpisodeTitle(raw: string): ParsedTitle {
  let rest = raw.replace(/\s+/g, " ").trim();
  let date: Date | null = null;

  const lead = /^(\d{1,2}[-./]\d{1,2}[-./](?:\d{4}|\d{2}))(?=$|[\s|–—\-:,])/.exec(rest);
  if (lead) {
    date = parseDayMonthYear(lead[1]);
    rest = rest.slice(lead[0].length);
  }

  let speaker: string | null = null;
  const sp = SPEAKER_RE.exec(rest);
  if (sp) {
    speaker = normaliseSpeaker(sp[1]);
    rest = rest.slice(0, sp.index);
  }

  let title: string | null = rest.replace(/^[\s|–—\-:,]+|[\s|–—\-:,]+$/g, "").trim() || null;
  if (title && (PLACEHOLDER_RE.test(title) || /^[\d\s\-./]+$/.test(title))) title = null;

  const missing: ParsedTitle["missing"] = [];
  if (!title) missing.push("title");
  if (!date) missing.push("date");
  return { title, date, speaker, missing };
}
