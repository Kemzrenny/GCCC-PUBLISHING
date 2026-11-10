import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { optionalUser } from "@/lib/auth";
import { consentUrl, driveClientConfigured, newState } from "@/lib/drive";
import { appUrl } from "@/lib/site";

// Settings › Connect Google Drive: sends an admin to Google to allow the backup.
export async function GET() {
  const user = await optionalUser();
  if (!user || user.role !== "ADMIN") return NextResponse.redirect(`${appUrl()}/login`);
  if (!driveClientConfigured()) return NextResponse.redirect(`${appUrl()}/settings?drive=missing-client`);
  const state = newState();
  (await cookies()).set("gccc_google_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/google",
  });
  return NextResponse.redirect(consentUrl(state));
}
