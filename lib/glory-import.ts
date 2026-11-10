import "server-only";
import { prisma } from "@/lib/prisma";
import { episodeSlug, detailsFromEpisodePage } from "@/lib/podbean-parse";
import { readMasterSheet, type SheetManual } from "@/lib/glory-sheet";
import { masterSheetCells } from "@/lib/glory-sheet-load";
import { STAGES, titleCore, similarity, manualCode, docTitle, type Stage } from "@/lib/glory";
import { gloryFolder, uploadFile } from "@/lib/glory-drive";
import { accessToken } from "@/lib/drive";
import { markSheetDirty, setSetting } from "@/lib/settings";

// Bringing in the manuals done before the portal: the Glory Home schedule's MASTER SHEET
// (numbers, topics, writers, Saturdays, which sermon) and the Glory Home folder's documents.

type Sermon = SheetManual["sermon"];

// ---- Finding a sermon's message ----

const DAY = 86_400_000;

async function byTitle(title: string | null, date: Date | null): Promise<string | null> {
  const core = titleCore(title);
  if (core.length < 4) return null;
  const words = core.split(" ").filter((w) => w.length > 3).slice(0, 3);
  const candidates = await prisma.message.findMany({
    where: { AND: words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } })) },
    select: { id: true, title: true, date: true },
    take: 40,
  });
  const close = candidates
    .map((m) => ({ ...m, score: titleCore(m.title) === core ? 1 : similarity(m.title, title ?? "") }))
    .filter((m) => m.score >= 0.8);
  if (!close.length) return null;
  if (date) {
    close.sort((a, b) => Math.abs((a.date?.getTime() ?? 0) - date.getTime()) - Math.abs((b.date?.getTime() ?? 0) - date.getTime()));
    const best = close[0];
    if (best.date && Math.abs(best.date.getTime() - date.getTime()) < 21 * DAY) return best.id;
  }
  const exact = close.filter((m) => m.score === 1);
  return exact.length === 1 ? exact[0].id : close.length === 1 ? close[0].id : null;
}

async function bySlug(slug: string): Promise<string | null> {
  const m = await prisma.message.findFirst({
    where: { OR: [{ sourceUrl: { endsWith: `/e/${slug}`, mode: "insensitive" } }, { sourceUrl: { contains: `/e/${slug}/`, mode: "insensitive" } }] },
    select: { id: true },
  });
  return m?.id ?? null;
}

export async function matchSermon(s: Sermon, cache = new Map<string, string | null>()): Promise<string | null> {
  const key = s.link ?? titleCore(s.title);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  let id: string | null = null;
  const slug = s.link ? episodeSlug(s.link) : null;
  if (slug) id = await bySlug(slug);
  // Podbean share links ("podbean.com/ew/pb-xh5g6-19532b7"): the same link may be in the
  // library already; if not, the share page names the episode.
  const pb = s.link ? /\bpb-([a-z0-9]+-[a-z0-9]+)/i.exec(s.link)?.[1] : null;
  if (!id && pb) {
    const m = await prisma.message.findFirst({ where: { sourceUrl: { contains: `pb-${pb}`, mode: "insensitive" } }, select: { id: true } });
    id = m?.id ?? null;
    if (!id) {
      try {
        const res = await fetch(`https://www.podbean.com/ew/pb-${pb}`, { headers: { "User-Agent": "Mozilla/5.0 (GCCC Publishing Portal)" }, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const html = await res.text();
          const inner = /https?:\/\/[a-z0-9.-]*podbean\.com\/e\/([^"'\s/?#<]+)/i.exec(html)?.[1];
          if (inner) id = await bySlug(inner.toLowerCase());
          if (!id) {
            const page = detailsFromEpisodePage(html);
            id = await byTitle(page.title, page.published ?? s.date);
          }
        }
      } catch {}
    }
  }
  if (!id) id = await byTitle(s.title, s.date);
  cache.set(key, id);
  return id;
}

// ---- The master sheet ----

export type SheetImportResult = { manuals: number; created: number; updated: number; matched: number; unmatched: number; linedUp: number };

const later = (a: Stage, b: Stage): Stage => (STAGES.indexOf(a) >= STAGES.indexOf(b) ? a : b);

export async function importMasterSheet(buffer: Buffer): Promise<SheetImportResult> {
  const rows = readMasterSheet(await masterSheetCells(buffer));
  const result: SheetImportResult = { manuals: 0, created: 0, updated: 0, matched: 0, unmatched: 0, linedUp: 0 };
  const cache = new Map<string, string | null>();
  for (const r of rows) {
    const messageId = await matchSermon(r.sermon, cache);
    const existing = await prisma.manual.findFirst({
      where: { OR: [{ importKey: r.key }, ...(r.number ? [{ number: r.number }] : [])] },
      orderBy: { createdAt: "asc" },
    });
    const data = {
      title: r.topic ?? existing?.title ?? null,
      number: r.number,
      code: manualCode(r.number) ?? existing?.code ?? null,
      saturday: r.saturday ?? existing?.saturday ?? null,
      stage: existing ? later(existing.stage as Stage, r.stage) : r.stage,
      plannedMonth: r.plannedMonth,
      part: r.part ?? existing?.part ?? null,
      parts: r.parts ?? existing?.parts ?? null,
      membersWriter: r.membersWriter ?? existing?.membersWriter ?? null,
      guideWriter: r.guideWriter ?? existing?.guideWriter ?? null,
      // Links to the old copies, until the documents are brought into the Glory Home folder.
      membersUrl: existing?.membersDocId ? existing.membersUrl : (r.membersLink ?? existing?.membersUrl ?? null),
      guideUrl: existing?.guideDocId ? existing.guideUrl : (r.guideLink ?? existing?.guideUrl ?? null),
      sourceTitle: r.sermon.title,
      sourceLink: r.sermon.link,
      notes: r.notes ?? existing?.notes ?? null,
      messageId: existing?.messageId ?? messageId,
      importKey: r.key,
    };
    if (existing) {
      await prisma.manual.update({ where: { id: existing.id }, data });
      result.updated++;
    } else {
      await prisma.manual.create({ data: { ...data, source: "master-sheet" } });
      result.created++;
    }
    if (r.number) result.manuals++;
    else result.linedUp++;
    if (data.messageId) result.matched++;
    else result.unmatched++;
  }
  await markSheetDirty();
  await setSetting("gloryLastImport", JSON.stringify({ at: new Date().toISOString(), sheet: result }));
  return result;
}

// ---- One manual's documents from the folder ----

export type FileMeta = {
  key: string;
  title: string;
  year: number | null;
  month: number | null;
  day: number | null;
  number: number | null;
  folder: string;
};

export type FileImportResult = { manualId: string; matched: boolean; uploaded: number; kept: number; label: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function folderFor(meta: FileMeta, saturday: Date | null): string[] {
  const y = saturday?.getUTCFullYear() ?? meta.year;
  const m = saturday ? saturday.getUTCMonth() + 1 : meta.month;
  if (!y) return ["Undated"];
  if (!m) return [`${y} Manuals`, "Undated"];
  return [`${y} Manuals`, `${String(m).padStart(2, "0")}_${MONTHS[m - 1]}_${y}`];
}

async function findManual(meta: FileMeta, date: Date | null) {
  const key = `drive:${meta.key}`;
  const own = await prisma.manual.findUnique({ where: { importKey: key } });
  if (own) return { manual: own, matched: true };
  if (meta.number) {
    const byNumber = await prisma.manual.findFirst({ where: { number: meta.number } });
    // A number in a file name is only trusted if the titles don't disagree.
    if (byNumber && (!byNumber.title || !meta.title || similarity(byNumber.title, meta.title) >= 0.3)) return { manual: byNumber, matched: true };
  }
  if (meta.title && titleCore(meta.title).length > 3) {
    const year = meta.year;
    const pool = await prisma.manual.findMany({
      where: year ? { OR: [{ saturday: { gte: new Date(Date.UTC(year - 1, 6, 1)), lt: new Date(Date.UTC(year + 1, 6, 1)) } }, { saturday: null }] } : {},
      select: { id: true, title: true, saturday: true },
    });
    const scored = pool
      .map((m) => ({ ...m, score: m.title ? similarity(m.title, meta.title) : 0 }))
      .filter((m) => m.score >= 0.75)
      .sort((a, b) => b.score - a.score || Math.abs((a.saturday?.getTime() ?? 0) - (date?.getTime() ?? 0)) - Math.abs((b.saturday?.getTime() ?? 0) - (date?.getTime() ?? 0)));
    if (scored[0]) return { manual: await prisma.manual.findUniqueOrThrow({ where: { id: scored[0].id } }), matched: true };
  }
  if (date) {
    const sameDay = await prisma.manual.findMany({ where: { saturday: date } });
    if (sameDay.length === 1 && (!meta.title || !sameDay[0].title)) return { manual: sameDay[0], matched: true };
  }
  const manual = await prisma.manual.create({
    data: {
      title: meta.title || null,
      number: meta.number,
      code: manualCode(meta.number),
      saturday: date,
      stage: "TAUGHT",
      source: "drive",
      importKey: key,
      notes: `From the Glory Home folder: ${meta.folder}`,
    },
  });
  return { manual, matched: false };
}

export async function importManualFiles(meta: FileMeta, files: { kind: "members" | "guide"; name: string; type: string; data: Buffer }[]): Promise<FileImportResult> {
  const date = meta.year && meta.month && meta.day ? new Date(Date.UTC(meta.year, meta.month - 1, meta.day)) : null;
  const { manual, matched } = await findManual(meta, date);
  const token = await accessToken();
  const saturday = manual.saturday ?? date;
  let folder: string | null = null;
  const data: Record<string, unknown> = {};
  let uploaded = 0;
  let kept = 0;
  for (const f of files) {
    const has = f.kind === "members" ? manual.membersDocId : manual.guideDocId;
    if (has) {
      kept++;
      continue;
    }
    folder ??= await gloryFolder(token, folderFor(meta, saturday));
    const name = docTitle(f.kind, { number: manual.number, title: manual.title ?? meta.title });
    const up = await uploadFile(token, { name, original: f.name, mime: f.type, data: f.data, parent: folder });
    Object.assign(data, f.kind === "members" ? { membersDocId: up.id, membersUrl: up.webViewLink } : { guideDocId: up.id, guideUrl: up.webViewLink });
    uploaded++;
  }
  if (!manual.saturday && date) data.saturday = date;
  if (!manual.title && meta.title) data.title = meta.title;
  if (Object.keys(data).length) await prisma.manual.update({ where: { id: manual.id }, data });
  return { manualId: manual.id, matched, uploaded, kept, label: [manualCode(manual.number), manual.title ?? meta.title].filter(Boolean).join(" · ") || meta.folder };
}
