"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { importSheetCsv } from "@/lib/sheet-import";
import { syncSheet } from "@/lib/sheets";
import { setSetting } from "@/lib/settings";
import { isProvider, providerConfigured } from "@/lib/transcribe";
import { kickRunner } from "@/lib/jobs";
import type { ActionResult } from "./messages";

const ROLES: Role[] = ["ADMIN", "REVIEWER", "WRITER", "VIEWER"];

function fail(err: unknown): ActionResult {
  return { error: err instanceof Error ? err.message : "Something went wrong." };
}

export async function importSheet(
  _: (ActionResult & { problems?: string[] }) | null,
  form: FormData
): Promise<(ActionResult & { problems?: string[] }) | null> {
  try {
    await requireUser(["ADMIN"]);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose the CSV file you downloaded from the sheet." };
    if (file.size > 20 * 1024 * 1024) return { error: "That file is too large for a sheet export." };
    const r = await importSheetCsv(await file.text());
    revalidatePath("/", "layout");
    return {
      ok: `Imported ${r.rows} rows: ${r.created} new, ${r.updated} updated, ${r.manuals} manuals linked.`,
      problems: r.problems,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function syncSheetNow(): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    const { rows } = await syncSheet();
    revalidatePath("/settings");
    return { ok: `Sheet updated with ${rows} messages.` };
  } catch (err) {
    await setSetting("sheetLastError", err instanceof Error ? err.message : "Sync failed").catch(() => {});
    return fail(err);
  }
}

const settingsSchema = z.object({
  transcribeProvider: z.string(),
  batchSize: z.coerce.number().int().min(1).max(50),
  batchOrder: z.enum(["newest", "oldest"]),
  autoTranscribeNew: z.enum(["0", "1"]),
  manualsWritten: z.coerce.number().int().min(0).max(100000),
});

export async function saveSettings(_: ActionResult, form: FormData): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    const parsed = settingsSchema.safeParse({
      transcribeProvider: form.get("transcribeProvider"),
      batchSize: form.get("batchSize"),
      batchOrder: form.get("batchOrder"),
      autoTranscribeNew: form.get("autoTranscribeNew") === "on" ? "1" : "0",
      manualsWritten: form.get("manualsWritten"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const s = parsed.data;
    if (!isProvider(s.transcribeProvider)) return { error: "Pick a transcription service." };
    if (!providerConfigured(s.transcribeProvider)) return { error: "That service's API key isn't set up yet." };
    await Promise.all([
      setSetting("transcribeProvider", s.transcribeProvider),
      setSetting("batchSize", String(s.batchSize)),
      setSetting("batchOrder", s.batchOrder),
      setSetting("autoTranscribeNew", s.autoTranscribeNew),
      setSetting("manualsWritten", String(s.manualsWritten)),
    ]);
    revalidatePath("/", "layout");
    return { ok: "Settings saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function inviteMember(_: ActionResult, form: FormData): Promise<ActionResult> {
  try {
    const me = await requireUser(["ADMIN"]);
    const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
    const role = String(form.get("role"));
    if (!email.success) return { error: "Enter a valid email." };
    if (!ROLES.includes(role as Role)) return { error: "Pick a role." };
    if (await prisma.user.findUnique({ where: { email: email.data } })) return { error: "That person already has an account." };
    await prisma.invite.upsert({
      where: { email: email.data },
      create: { email: email.data, role: role as Role, invitedById: me.id },
      update: { role: role as Role },
    });
    revalidatePath("/settings");
    return { ok: `Invited ${email.data}. They can now create their account on the sign-in page.` };
  } catch (err) {
    return fail(err);
  }
}

export async function removeInvite(email: string): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    await prisma.invite.delete({ where: { email } }).catch(() => {});
    revalidatePath("/settings");
    return { ok: "Invite removed." };
  } catch (err) {
    return fail(err);
  }
}

export async function updateMember(userId: string, change: { role?: Role; disabled?: boolean }): Promise<ActionResult> {
  try {
    const me = await requireUser(["ADMIN"]);
    if (userId === me.id) return { error: "You can't change your own access." };
    if (change.role && !ROLES.includes(change.role)) return { error: "Unknown role." };
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(change.role ? { role: change.role } : {}),
        ...(change.disabled === undefined ? {} : { disabledAt: change.disabled ? new Date() : null }),
      },
    });
    revalidatePath("/settings");
    return { ok: "Updated." };
  } catch (err) {
    return fail(err);
  }
}

export async function setTheme(theme: "light" | "dark") {
  (await cookies()).set("theme", theme, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
}

export async function runQueueNow(): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN", "REVIEWER"]);
    after(kickRunner);
    return { ok: "Started. Refresh the review queue in a few minutes." };
  } catch (err) {
    return fail(err);
  }
}
