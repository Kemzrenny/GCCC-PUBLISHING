import { parseDayMonthYear, findDateInText, lagosDay, looksLikeFuture } from "./dates";

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
    // "OLAWALE" -> "Olawale", "kunle" -> "Kunle".
    if (/^[A-Z]{3,}$/.test(w)) return w[0] + w.slice(1).toLowerCase();
    if (/^[a-z]/.test(w)) return w[0].toUpperCase() + w.slice(1);
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

  // Not at the start: look for a date anywhere ("Faith That Works 23rd July 2023").
  if (!date) {
    const found = findDateInText(rest);
    if (found) {
      date = found.date;
      // Take the weekday before it too ("Sunday 12th March 2023").
      const escaped = found.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const withDay = new RegExp(`(?:\\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?\\.?,?\\s+)?${escaped}`, "i");
      rest = rest.replace(withDay, " ").replace(/\s+/g, " ").trim();
    }
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

// ---- Episode pages ----

// Is this a Podbean episode page (where the audio can be looked up)?
export function isPodbeanEpisode(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return /(^|\.)podbean\.com$/i.test(u.hostname) && u.pathname.startsWith("/e/");
  } catch {
    return false;
  }
}

// The same page written slightly differently (http/https, trailing slash, letter case,
// a query string) should count as the same episode.
// The episode's own part of a Podbean link ("/e/faith-that-works/" → "faith-that-works"),
// the same whichever Podbean address the link was copied from.
export function episodeSlug(url: string): string | null {
  const m = /podbean\.com\/e\/([^/?#\s]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

export function urlVariants(url: string): string[] {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "");
    const hosts = [u.hostname.toLowerCase()];
    const out = new Set<string>();
    for (const proto of ["https:", "http:"]) for (const h of hosts) for (const p of [path, `${path}/`]) out.add(`${proto}//${h}${p}`);
    out.add(url);
    return [...out];
  } catch {
    return [url];
  }
}

// The audio file's address on a Podbean episode page: the page's structured data
// (associatedMedia.contentUrl), then its og:audio tag, then any Podbean audio link.
export function audioFromEpisodePage(html: string): string | null {
  const clean = (s: string) => decodeEntities(s.replace(/\\\//g, "/"));
  const isAudio = (s: string) => /^https?:\/\//i.test(s) && /\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(s);
  for (const block of html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const media = /"associatedMedia"\s*:\s*\{([^}]+)\}/.exec(block);
    for (const m of (media?.[1] ?? block).matchAll(/"contentUrl"\s*:\s*"([^"]+)"/g)) {
      const url = clean(m[1]);
      if (isAudio(url)) return url;
    }
  }
  for (const prop of ["og:audio", "og:audio:url", "og:audio:secure_url"]) {
    const m = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)`, "i").exec(html) ?? new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i").exec(html);
    if (m && isAudio(clean(m[1]))) return clean(m[1]);
  }
  const any = /https?:\\?\/\\?\/[a-z0-9.-]*podbean\.com\\?\/[^"'\s<>]+?\.(?:mp3|m4a)/i.exec(html);
  return any ? clean(any[0]) : null;
}

// The title, description and publish time on a Podbean episode page, from its structured
// data or, failing that, its Open Graph tags. Old episodes drop out of the feed, but their
// pages keep these.
export function detailsFromEpisodePage(html: string): { title: string | null; description: string; published: Date | null } {
  const clean = (s: string) => decodeEntities(s.replace(/\\\//g, "/").replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"'));
  const all = (html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? []).join("\n");
  // Read the episode's own fields, not the podcast's (which also has a "name").
  const at = all.search(/"@type"\s*:\s*"PodcastEpisode"/);
  const blocks = at >= 0 ? all.slice(Math.max(0, all.lastIndexOf("{", at))) : all;
  const ld = (key: string) => new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(blocks)?.[1];
  const meta = (prop: string) =>
    (new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)`, "i").exec(html) ??
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i").exec(html))?.[1];
  const rawTitle = ld("name") ?? meta("og:title") ?? null;
  const rawDate = ld("datePublished") ?? ld("uploadDate") ?? meta("article:published_time") ?? null;
  const published = rawDate ? new Date(clean(rawDate)) : null;
  return {
    title: rawTitle ? clean(rawTitle).replace(/\s*\|\s*Podbean\s*$/i, "").trim() || null : null,
    description: clean(ld("description") ?? meta("og:description") ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    published: published && !Number.isNaN(published.getTime()) ? published : null,
  };
}

// ---- Dates from Podbean ----

export type EpisodeDate = { date: Date; fromUpload: boolean } | null;

// The best date for an episode: one written in its title, then in its description, then
// the day it was uploaded to Podbean.
export function episodeDate(ep: { title: string; description: string; pubDate: Date | null }, now = new Date()): EpisodeDate {
  const fromTitle = parseEpisodeTitle(ep.title).date;
  if (fromTitle && !looksLikeFuture(fromTitle, now)) return { date: fromTitle, fromUpload: false };
  const fromDescription = findDateInText(ep.description)?.date;
  if (fromDescription && !looksLikeFuture(fromDescription, now)) return { date: fromDescription, fromUpload: false };
  if (ep.pubDate) {
    const day = lagosDay(ep.pubDate);
    if (!looksLikeFuture(day, now)) return { date: day, fromUpload: true };
  }
  return null;
}
