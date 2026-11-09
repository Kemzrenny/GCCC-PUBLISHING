import { NextResponse, after } from "next/server";
import { runJobs, kickRunner } from "@/lib/jobs";
import { optionalUser, canReview } from "@/lib/auth";

// Works the transcription queue for up to ~4 minutes, then hands over to a fresh run if
// anything is left. Called by the portal itself after work is queued, by the schedule,
// or by a reviewer from Settings.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function allowed(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  const user = await optionalUser();
  return !!user && canReview(user.role);
}

export async function POST(req: Request) {
  if (!(await allowed(req))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const result = await runJobs(240_000);
  if (result.remaining > 0 && result.steps > 0) after(kickRunner);
  return NextResponse.json(result);
}

export const GET = POST;
