import "server-only";
import { prisma } from "@/lib/prisma";
import {
  parseFeed,
  parseEpisodeTitle,
  urlVariants,
  episodeSlug,
  isPodbeanEpisode,
  detailsFromEpisodePage,
  audioFromEpisodePage,
} from "@/lib/podbean-parse";
import { enqueue } from "@/lib/jobs";
import { getSetting, setSetting, markSheetDirty } from "@/lib/settings";
import { speakerResolver } from "@/lib/speakers";
import { titleKnown } from "@/lib/needs";
import { findDateInText, lagosDay, looksLikeFuture } from "@/lib/dates";

// Checks the GCCC Podbean feed for episodes the portal hasn't seen and adds them to the
// library, then fills in messages still waiting for a title or date (from Podbean or the old
// sheet). Podbean only lists its most recent episodes in the feed, so for older ones the
// portal reads each episode's own page. A date comes from the title, then the description,
// then the day the episode was published (in Lagos), marked as an upload date so anyone
// can correct it. Details a person has confirmed are never overwritten.

export const feedUrl = () => process.env.PODBEAN_FEED_URL ?? "https://feed.podbean.com/gcccpodcasts/feed.xml";

// Why the messages still waiting couldn't be filled in, with a few examples of each.
export type WaitingReport = {
  waiting: number;
  notOnPodbean: number;
  toLookUp: number;
  noTitle: number;
  catchUp: number;
  noDate: number;
  pagesRead: number;
  pagesFailed: number;
  samples: { noTitle: string[]; catchUp: string[]; noDate: string[] };
};

export type PodbeanResult = {
  checked: number;
  added: number;
  linked: number;
  needsDetails: number;
  queued: number;
  resolved: number;
  report?: WaitingReport;
};

const PAGE_BUDGET_MS = 40_000;
const PAGE_CONCURRENCY = 6;

export async function checkPodbean(): Promise<PodbeanResult> {
  const res = await fetch(feedUrl(), { headers: { "User-Agent": "GCCC Publishing Portal" }, cache: "no-store" });
  if (!res.ok) throw new Error(`The Podbean feed answered ${res.status}.`);
  const episodes = parseFeed(await res.text());

  const speakerOf = await speakerResolver();
  const result: PodbeanResult = { checked: episodes.length, added: 0, linked: 0, needsDetails: 0, queued: 0, resolved: 0 };
  const newIds: string[] = [];
  // Descriptions aren't stored, so keep this run's for finding dates.
  const descriptions = new Map<string, string>();

  // 1. The feed: add new episodes, link old sheet rows to theirs.
  for (const ep of episodes) {
    const slug = ep.link ? episodeSlug(ep.link) : null;
    const existing = await prisma.message.findFirst({
      where: {
        OR: [
          { podbeanGuid: ep.guid },
          ...(ep.link ? [{ sourceUrl: { in: urlVariants(ep.link) } }] : []),
          // Old sheet links may use another Podbean address for the same episode.
          ...(slug
            ? [
                { sourceUrl: { endsWith: `/e/${slug}`, mode: "insensitive" as const } },
                { sourceUrl: { contains: `/e/${slug}/`, mode: "insensitive" as const } },
              ]
            : []),
          ...(ep.audioUrl ? [{ audioUrl: ep.audioUrl }] : []),
        ],
      },
    });

    if (existing) {
      descriptions.set(existing.id, ep.description);
      const fill: Record<string, unknown> = {};
      if (!existing.podbeanGuid) fill.podbeanGuid = ep.guid;
      if (!existing.audioUrl && ep.audioUrl) fill.audioUrl = ep.audioUrl;
      if (!existing.durationSec && ep.durationSec) fill.durationSec = ep.durationSec;
      if (!existing.podbeanTitle) fill.podbeanTitle = ep.title;
      if (!existing.sourceUrl && ep.link) fill.sourceUrl = ep.link;
      if (!existing.podbeanPublishedAt && ep.pubDate) fill.podbeanPublishedAt = ep.pubDate;
      if (Object.keys(fill).length) {
        await prisma.message.update({ where: { id: existing.id }, data: fill }).catch(() => {});
        result.linked++;
      }
      continue;
    }

    const parsed = parseEpisodeTitle(ep.title);
    const created = await prisma.message.create({
      data: {
        podbeanGuid: ep.guid,
        sourceUrl: ep.link,
        audioUrl: ep.audioUrl,
        durationSec: ep.durationSec,
        podbeanTitle: ep.title,
        podbeanPublishedAt: ep.pubDate,
        title: parsed.title ?? (ep.title.trim() || "Untitled message"),
        // A guess for sorting until step 3 (or a person) settles it.
        date: parsed.date ?? (ep.pubDate ? lagosDay(ep.pubDate) : null),
        dateFromUpload: !parsed.date && !!ep.pubDate,
        speaker: speakerOf(parsed.speaker),
        location: process.env.DEFAULT_LOCATION ?? null,
        needsDetails: true,
      },
    });
    descriptions.set(created.id, ep.description);
    result.added++;
    newIds.push(created.id);
  }

  // 2. Older episodes aren't in the feed: read their pages, a batch per check.
  const pages = await readEpisodePages(descriptions);

  // 3. Fill in everything still waiting.
  const report = await resolveWaiting(descriptions, speakerOf, newIds, result);
  report.pagesRead = pages.read;
  report.pagesFailed = pages.failed;
  result.report = report;

  if (newIds.length && (await getSetting("autoTranscribeNew")) === "1") {
    result.queued = await enqueue(newIds);
  }
  if (result.added || result.linked || result.resolved) await markSheetDirty();
  await setSetting("podbeanLastCheck", new Date().toISOString());
  await setSetting("podbeanLastResult", JSON.stringify(result));
  return result;
}

async function readEpisodePages(descriptions: Map<string, string>) {
  const started = Date.now();
  const out = { read: 0, failed: 0 };
  const todo = await prisma.message.findMany({
    where: { needsDetails: true, detailsLocked: false, podbeanPublishedAt: null, sourceUrl: { contains: "podbean.com/e/" } },
    // Pages that failed last time were touched, so they come last.
    orderBy: { updatedAt: "asc" },
    take: 400,
    select: { id: true, sourceUrl: true, podbeanTitle: true, audioUrl: true },
  });
  const queue = todo.filter((m) => isPodbeanEpisode(m.sourceUrl));

  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      if (Date.now() - started > PAGE_BUDGET_MS) return;
      try {
        const res = await fetch(m.sourceUrl!, {
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (GCCC Publishing Portal)" },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const html = await res.text();
        const page = detailsFromEpisodePage(html);
        if (!page.published && !page.title) throw new Error("nothing on the page");
        descriptions.set(m.id, page.description);
        const audio = m.audioUrl ? null : audioFromEpisodePage(html);
        await prisma.message.update({
          where: { id: m.id },
          data: {
            ...(page.published ? { podbeanPublishedAt: page.published } : {}),
            ...(!m.podbeanTitle && page.title ? { podbeanTitle: page.title } : {}),
            ...(audio ? { audioUrl: audio } : {}),
            updatedAt: new Date(),
          },
        });
        out.read++;
      } catch {
        out.failed++;
        await prisma.message.update({ where: { id: m.id }, data: { updatedAt: new Date() } }).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, worker));
  return out;
}

async function resolveWaiting(
  descriptions: Map<string, string>,
  speakerOf: (name: string | null) => string | null,
  newIds: string[],
  result: PodbeanResult,
): Promise<WaitingReport> {
  const newSet = new Set(newIds);

  const waiting = await prisma.message.findMany({
    where: { needsDetails: true, detailsLocked: false },
    select: { id: true, title: true, podbeanTitle: true, podbeanPublishedAt: true, date: true, dateFromUpload: true, speaker: true, sourceUrl: true },
  });
  const report: WaitingReport = {
    waiting: 0,
    notOnPodbean: 0,
    toLookUp: 0,
    noTitle: 0,
    catchUp: 0,
    noDate: 0,
    pagesRead: 0,
    pagesFailed: 0,
    samples: { noTitle: [], catchUp: [], noDate: [] },
  };
  const sample = (list: string[], s: string) => list.length < 5 && list.push(s);

  for (const m of waiting) {
    const parsed = m.podbeanTitle ? parseEpisodeTitle(m.podbeanTitle) : null;
    let title = m.title;
    if (!titleKnown(m) && parsed?.title) title = parsed.title;
    const known = titleKnown({ ...m, title });

    let date: Date | null = null;
    let fromUpload = false;
    if (parsed?.date && !looksLikeFuture(parsed.date)) date = parsed.date;
    if (!date) {
      const d = findDateInText(descriptions.get(m.id) ?? "")?.date;
      if (d && !looksLikeFuture(d)) date = d;
    }
    // The team chose to use the upload day even for batch uploads; it's marked so it can
    // be corrected.
    if (!date && m.podbeanPublishedAt) {
      date = lagosDay(m.podbeanPublishedAt);
      fromUpload = true;
    }

    const data: Record<string, unknown> = {};
    if (title !== m.title) data.title = title;
    if (date && (date.getTime() !== m.date?.getTime() || fromUpload !== m.dateFromUpload)) Object.assign(data, { date, dateFromUpload: fromUpload });
    if (!m.speaker && parsed?.speaker) data.speaker = speakerOf(parsed.speaker);
    if (known && date) {
      data.needsDetails = false;
      if (!newSet.has(m.id)) result.resolved++;
    } else {
      report.waiting++;
      if (newSet.has(m.id)) result.needsDetails++;
      const label = m.podbeanTitle ?? m.title;
      if (!m.podbeanTitle && !m.podbeanPublishedAt) {
        if (isPodbeanEpisode(m.sourceUrl)) report.toLookUp++;
        else report.notOnPodbean++;
      } else if (!known) {
        report.noTitle++;
        sample(report.samples.noTitle, label);
      } else {
        report.noDate++;
        sample(report.samples.noDate, label);
      }
    }
    if (Object.keys(data).length) await prisma.message.update({ where: { id: m.id }, data }).catch(() => {});
  }
  return report;
}
