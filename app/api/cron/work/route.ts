import { NextResponse, after } from "next/server";
import { checkPodbean, finishLookups } from "@/lib/podbean";
import { runJobs, kickRunner } from "@/lib/jobs";
import { syncSheet, sheetConfigured } from "@/lib/sheets";
import { getSetting, setSetting } from "@/lib/settings";
import { backupPending, driveConnected } from "@/lib/drive";
import { readProgress } from "@/lib/glory-drive";
import { prisma } from "@/lib/prisma";

// The scheduled round (vercel.json): look for new Podbean episodes, move the transcription
// queue along, and bring the Google Sheet up to date if anything changed.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const report: Record<string, unknown> = {};
  try {
    const podbean = await checkPodbean();
    report.podbean = podbean;
    if (podbean.report?.toLookUp) after(() => finishLookups(60_000).catch(() => {}));
  } catch (err) {
    report.podbean = { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const jobs = await runJobs(200_000);
    report.jobs = jobs;
    if (jobs.remaining > 0) after(kickRunner);
  } catch (err) {
    report.jobs = { error: err instanceof Error ? err.message : String(err) };
  }
  // Glory Home writing progress for the manuals coming up.
  try {
    if (await driveConnected()) {
      const now = Date.now();
      const soon = await prisma.manual.findMany({
        where: {
          stage: { not: "TAUGHT" },
          saturday: { gte: new Date(now - 7 * 86_400_000), lte: new Date(now + 35 * 86_400_000) },
          OR: [{ membersDocId: { not: null } }, { guideDocId: { not: null } }],
        },
        select: { id: true },
        take: 20,
      });
      await readProgress(soon.map((m) => m.id));
      report.progress = soon.length;
    }
  } catch (err) {
    report.progress = { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    report.drive = await backupPending(25);
  } catch (err) {
    report.drive = { error: err instanceof Error ? err.message : String(err) };
  }
  if (sheetConfigured() && (await getSetting("sheetDirty")) === "1") {
    try {
      report.sheet = await syncSheet();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setSetting("sheetLastError", message).catch(() => {});
      report.sheet = { error: message };
    }
  }
  return NextResponse.json(report);
}

export const POST = GET;
