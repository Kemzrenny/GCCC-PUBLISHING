import "server-only";
import { prisma } from "@/lib/prisma";
import { parseFeed, parseEpisodeTitle } from "@/lib/podbean-parse";
import { enqueue } from "@/lib/jobs";
import { getSetting, setSetting, markSheetDirty } from "@/lib/settings";

// Checks the GCCC Podbean feed for episodes the portal hasn't seen, adds them to the
// library, flags any whose title is missing a title or date, and (by default) queues them
// for transcription. Episodes already in the library get their audio link filled in if it
// was missing, but their details are never overwritten once a person has confirmed them.

export const feedUrl = () => process.env.PODBEAN_FEED_URL ?? "https://feed.podbean.com/gcccpodcasts/feed.xml";

export type PodbeanResult = { checked: number; added: number; linked: number; needsDetails: number; queued: number };

export async function checkPodbean(): Promise<PodbeanResult> {
  const res = await fetch(feedUrl(), { headers: { "User-Agent": "GCCC Publishing Portal" }, cache: "no-store" });
  if (!res.ok) throw new Error(`The Podbean feed answered ${res.status}.`);
  const episodes = parseFeed(await res.text());

  const result: PodbeanResult = { checked: episodes.length, added: 0, linked: 0, needsDetails: 0, queued: 0 };
  const newIds: string[] = [];

  for (const ep of episodes) {
    const existing = await prisma.message.findFirst({
      where: {
        OR: [{ podbeanGuid: ep.guid }, ...(ep.link ? [{ sourceUrl: ep.link }] : []), ...(ep.audioUrl ? [{ audioUrl: ep.audioUrl }] : [])],
      },
    });
    const parsed = parseEpisodeTitle(ep.title);

    if (existing) {
      // Matched to a row from the old sheet (by its Podbean link) or seen before.
      const fill: Record<string, unknown> = {};
      if (!existing.podbeanGuid) fill.podbeanGuid = ep.guid;
      if (!existing.audioUrl && ep.audioUrl) fill.audioUrl = ep.audioUrl;
      if (!existing.durationSec && ep.durationSec) fill.durationSec = ep.durationSec;
      if (!existing.podbeanTitle) fill.podbeanTitle = ep.title;
      if (!existing.sourceUrl && ep.link) fill.sourceUrl = ep.link;
      if (!existing.detailsLocked && parsed.missing.length === 0 && existing.needsDetails) {
        Object.assign(fill, { title: parsed.title, date: parsed.date, speaker: parsed.speaker ?? existing.speaker, needsDetails: false });
      }
      if (Object.keys(fill).length) {
        await prisma.message.update({ where: { id: existing.id }, data: fill }).catch(() => {});
        result.linked++;
      }
      continue;
    }

    const needsDetails = parsed.missing.length > 0;
    const created = await prisma.message.create({
      data: {
        podbeanGuid: ep.guid,
        sourceUrl: ep.link,
        audioUrl: ep.audioUrl,
        durationSec: ep.durationSec,
        podbeanTitle: ep.title,
        title: parsed.title ?? (ep.title.trim() || "Untitled message"),
        // Without a date in the title, the upload date is the best guess until someone confirms.
        date: parsed.date ?? (ep.pubDate ? new Date(Date.UTC(ep.pubDate.getUTCFullYear(), ep.pubDate.getUTCMonth(), ep.pubDate.getUTCDate())) : null),
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
