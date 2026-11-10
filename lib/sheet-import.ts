import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/csv";
import { mapSheet, type SheetRow } from "@/lib/sheet-map";
import { markSheetDirty } from "@/lib/settings";
import { speakerResolver } from "@/lib/speakers";

// One-time (and repeatable) import of the old Publishing sheet. Rows are matched to
// messages already in the portal by the sheet's ID, then by Podbean link, so importing
// the same sheet twice updates rather than duplicates. The sheet's details count as
// confirmed by the team, so Podbean never overwrites them afterwards.

export type ImportResult = { rows: number; created: number; updated: number; manuals: number; problems: string[] };

function messageData(r: SheetRow): Prisma.MessageUncheckedCreateInput {
  return {
    legacyId: r.legacyId,
    title: r.title,
    date: r.date,
    speaker: r.speaker,
    location: r.location,
    series: r.series,
    sourceUrl: r.sourceUrl,
    // The sheet's details count as confirmed, except a date that can't be right.
    detailsLocked: !r.dateSuspect,
    needsDetails: r.dateSuspect,
    status: r.transcribed ? "APPROVED" : "NOT_STARTED",
    externalTranscriptUrl: r.transcriptUrl,
    summary: r.summary,
    themes: r.themes,
    tractPotential: r.tractPotential,
    bookPotential: r.bookPotential,
    assigneeName: r.assigneeName,
    dueLabel: r.dueLabel,
  };
}

export async function importSheetCsv(csv: string): Promise<ImportResult> {
  const { rows, error } = mapSheet(parseCsv(csv));
  if (error) throw new Error(error);
  const speakerOf = await speakerResolver();
  for (const r of rows) r.speaker = speakerOf(r.speaker);
  const result: ImportResult = { rows: rows.length, created: 0, updated: 0, manuals: 0, problems: [] };
  const seenUrls = new Set<string>();

  for (const r of rows) {
    const label = r.legacyId ? `Row ID ${r.legacyId}` : `"${r.title}"`;
    for (const p of r.problems) result.problems.push(`${label}: ${p}`);
    // Two rows with the same Podbean link: keep the first, report the second.
    if (r.sourceUrl && seenUrls.has(r.sourceUrl)) {
      result.problems.push(`${label}: same Podbean link as an earlier row, skipped`);
      continue;
    }
    if (r.sourceUrl) seenUrls.add(r.sourceUrl);

    const existing = await prisma.message.findFirst({
      where: { OR: [...(r.legacyId !== null ? [{ legacyId: r.legacyId }] : []), ...(r.sourceUrl ? [{ sourceUrl: r.sourceUrl }] : [])] },
      include: { transcript: { select: { id: true } } },
    });
    const data = messageData(r);
    let messageId: string;
    try {
      if (existing) {
        // Keep progress the portal has made (a portal transcript beats "not started").
        const keepStatus = existing.transcript || !["NOT_STARTED", "FAILED"].includes(existing.status);
        const { status, ...rest } = data;
        await prisma.message.update({
          where: { id: existing.id },
          data: { ...rest, ...(keepStatus ? {} : { status }), audioUrl: existing.audioUrl, podbeanGuid: existing.podbeanGuid },
        });
        messageId = existing.id;
        result.updated++;
      } else {
        messageId = (await prisma.message.create({ data })).id;
        result.created++;
      }
    } catch (err) {
      result.problems.push(`${label}: couldn't be saved (${err instanceof Error ? err.message.split("\n").pop() : "error"})`);
      continue;
    }

    if (r.manual) {
      const match = await prisma.manual.findFirst({
        where: { messageId, OR: [{ code: r.manual.code ?? undefined }, { title: r.manual.title ?? undefined }, { link: r.manual.link ?? undefined }] },
      });
      const num = r.manual.code ? Number(/\d+/.exec(r.manual.code)?.[0]) || null : null;
      // The old publishing sheet lists manuals already written.
      const manualData = { messageId, title: r.manual.title, code: r.manual.code, number: num, link: r.manual.link, membersUrl: r.manual.link, writer: r.manual.writer, status: r.manual.status, stage: "TAUGHT" as const, source: "publishing-sheet" };
      if (match) await prisma.manual.update({ where: { id: match.id }, data: manualData });
      else {
        await prisma.manual.create({ data: manualData });
        result.manuals++;
      }
    }
  }
  await markSheetDirty();
  result.problems = result.problems.slice(0, 200);
  return result;
}
