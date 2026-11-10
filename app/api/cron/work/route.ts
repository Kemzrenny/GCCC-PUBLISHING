import { NextResponse, after } from "next/server";
import { checkPodbean } from "@/lib/podbean";
import { runJobs, kickRunner } from "@/lib/jobs";
import { syncSheet, sheetConfigured } from "@/lib/sheets";
import { getSetting, setSetting } from "@/lib/settings";
import { backupPending } from "@/lib/drive";

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
    report.podbean = await checkPodbean();
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
