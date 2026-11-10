import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { optionalUser } from "@/lib/auth";
import { finishConnect } from "@/lib/drive";
import { appUrl } from "@/lib/site";

// Google sends the admin back here after they allow (or refuse) Drive access.
export async function GET(req: Request) {
  const back = (result: string) => NextResponse.redirect(`${appUrl()}/settings?drive=${encodeURIComponent(result)}#drive`);
  const user = await optionalUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(`${appUrl()}/login`);
  const url = new URL(req.url);
  const store = await cookies();
  const expected = store.get("gccc_google_state")?.value;
  store.delete({ name: "gccc_google_state", path: "/api/google" });
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back("expired");
  try {
    await finishConnect(code);
    return back("connected");
  } catch (err) {
    return back(err instanceof Error ? err.message : "failed");
  }
}
