import "server-only";
import { prisma } from "@/lib/prisma";
import { normaliseSpeaker } from "@/lib/podbean-parse";
import { markSheetDirty } from "@/lib/settings";

const key = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

// Tidies a speaker name and files it under the name the team chose on the Speakers page.
// Returns null for names marked "not a speaker".
export async function resolveSpeaker(raw: string | null | undefined): Promise<string | null> {
  const name = normaliseSpeaker(raw);
  if (!name) return null;
  const alias = await prisma.speakerAlias.findUnique({ where: { alias: key(name) } });
  if (!alias) return name;
  return alias.name || null;
}

// The same for many names at once (imports).
export async function speakerResolver(): Promise<(raw: string | null | undefined) => string | null> {
  const aliases = new Map((await prisma.speakerAlias.findMany()).map((a) => [a.alias, a.name]));
  return (raw) => {
    const name = normaliseSpeaker(raw);
    if (!name) return null;
    const to = aliases.get(key(name));
    return to === undefined ? name : to || null;
  };
}

// Files every message under `variants` as `target` (or under no speaker when target is
// null), and remembers each variant so later imports land in the right place.
export async function mergeSpeakers(target: string | null, variants: string[]): Promise<number> {
  const to = target ? normaliseSpeaker(target) : null;
  if (target && !to) throw new Error("Enter a name.");
  const from = [...new Set(variants.map((v) => v.trim()).filter((v) => v && v !== to))];
  if (!from.length) return 0;

  const moved = await prisma.$transaction(async (tx) => {
    const ids = (await tx.message.findMany({ where: { speaker: { in: from } }, select: { id: true } })).map((m) => m.id);
    await tx.message.updateMany({ where: { id: { in: ids } }, data: { speaker: to } });
    for (const v of from) {
      await tx.speakerAlias.upsert({ where: { alias: key(v) }, create: { alias: key(v), name: to ?? "" }, update: { name: to ?? "" } });
    }
    // Spellings that pointed at a merged name now point at the target.
    await tx.speakerAlias.updateMany({ where: { name: { in: from } }, data: { name: to ?? "" } });
    // The target is a real name, so it must not redirect anywhere.
    if (to) await tx.speakerAlias.deleteMany({ where: { alias: key(to) } });
    // The Google Doc names include the speaker: refresh those backups.
    if (ids.length) await tx.$executeRaw`UPDATE "Transcript" SET "driveSyncedAt" = NULL WHERE "messageId" = ANY(${ids}) AND "driveFileId" IS NOT NULL`;
    return ids.length;
  });
  await markSheetDirty();
  return moved;
}

export async function speakerCounts() {
  const rows = await prisma.message.groupBy({ by: ["speaker"], _count: { _all: true }, where: { speaker: { not: null } } });
  return rows
    .map((r) => ({ name: r.speaker as string, count: r._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
