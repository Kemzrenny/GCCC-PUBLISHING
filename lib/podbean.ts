import "server-only";
import { prisma } from "@/lib/prisma";
import { parseFeed, parseEpisodeTitle, urlVariants, episodeSlug, uploadDayCounts, episodeDate } from "@/lib/podbean-parse";
import { enqueue } from "@/lib/jobs";
import { getSetting, setSetting, markSheetDirty } from "@/lib/settings";
import { speakerResolver } from "@/lib/speakers";
import { titleKnown } from "@/lib/needs";

// Checks the GCCC Podbean feed for episodes the portal hasn't seen, adds them to the
// library, flags any whose title or date can't be worked out, and (by default) queues them
// for transcription. The date comes from the title, then the description, then the day the
// episode was uploaded. Messages still waiting for details (from Podbean or the old sheet)
// are filled in the same way, but details a person has confirmed are never overwritten.

export const feedUrl = () => process.env.PODBEAN_FEED_URL ?? "https://feed.podbean.com/gcccpodcasts/feed.xml";

export type PodbeanResult = { checked: number; added: number; linked: number; needsDetails: number; queued: number; resolved: number };

export async function checkPodbean(): Promise<PodbeanResult> {
  const res = await fetch(feedUrl(), { headers: { "User-Agent": "GCCC Publishing Portal" }, cache: "no-store" });
  if (!res.ok) throw new Error(`The Podbean feed answered ${res.status}.`);
  const episodes = parseFeed(await res.text());
  const uploads = uploadDayCounts(episodes);

  const speakerOf = await speakerResolver();
  const result: PodbeanResult = { checked: episodes.length, added: 0, linked: 0, needsDetails: 0, queued: 0, resolved: 0 };
  const newIds: string[] = [];

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
    const parsed = parseEpisodeTitle(ep.title);
    parsed.speaker = speakerOf(parsed.speaker);
    const dated = episodeDate(ep, uploads);

    if (existing) {
      // Matched to a row from the old sheet (by its Podbean link) or seen before.
      const fill: Record<string, unknown> = {};
      if (!existing.podbeanGuid) fill.podbeanGuid = ep.guid;
      if (!existing.audioUrl && ep.audioUrl) fill.audioUrl = ep.audioUrl;
      if (!existing.durationSec && ep.durationSec) fill.durationSec = ep.durationSec;
      if (!existing.podbeanTitle) fill.podbeanTitle = ep.title;
      if (!existing.sourceUrl && ep.link) fill.sourceUrl = ep.link;
      if (existing.needsDetails && !existing.detailsLocked) {
        const podbeanTitle = existing.podbeanTitle ?? ep.title;
        let title = existing.title;
        if (!titleKnown({ ...existing, podbeanTitle }) && parsed.title) title = fill.title = parsed.title;
        if (dated) Object.assign(fill, { date: dated.date, dateFromUpload: dated.fromUpload });
        if (!existing.speaker && parsed.speaker) fill.speaker = parsed.speaker;
        if (titleKnown({ title, podbeanTitle, date: null }) && dated) {
          fill.needsDetails = false;
          result.resolved++;
        }
      }
      if (Object.keys(fill).length) {
        await prisma.message.update({ where: { id: existing.id }, data: fill }).catch(() => {});
        result.linked++;
      }
      continue;
    }

    const needsDetails = !parsed.title || !dated;
    const created = await prisma.message.create({
      data: {
        podbeanGuid: ep.guid,
        sourceUrl: ep.link,
        audioUrl: ep.audioUrl,
        durationSec: ep.durationSec,
        podbeanTitle: ep.title,
        title: parsed.title ?? (ep.title.trim() || "Untitled message"),
        // Without a usable date, the upload day is still the best guess for sorting until
        // someone confirms.
        date: dated?.date ?? (ep.pubDate ? new Date(Date.UTC(ep.pubDate.getUTCFullYear(), ep.pubDate.getUTCMonth(), ep.pubDate.getUTCDate())) : null),
        dateFromUpload: dated ? dated.fromUpload : !!ep.pubDate,
        speaker: parsed.speaker,
        location: process.env.DEFAULT_LOCATION ?? null,
        needsDetails,
      },
    });
    result.added++;
    if (needsDetails) result.needsDetails++;
    newIds.push(created.id);
  }

  if (newIds.length && (await getSetting("autoTranscribeNew")) === "1") {
    result.queued = await enqueue(newIds);
  }
  if (result.added || result.linked) await markSheetDirty();
  await setSetting("podbeanLastCheck", new Date().toISOString());
  await setSetting("podbeanLastResult", JSON.stringify(result));
  return result;
}
