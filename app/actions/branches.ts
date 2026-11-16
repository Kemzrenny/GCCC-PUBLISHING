"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { setSetting, markSheetDirty } from "@/lib/settings";
import { parseBranches, type Branches } from "@/lib/branches";
import { branchChanges } from "@/lib/branch-apply";
import type { ActionResult } from "@/app/actions/messages";

const fail = (err: unknown): ActionResult => ({ error: err instanceof Error ? err.message : "Something went wrong." });

export async function saveBranches(input: Branches): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    const names = input.branches.map((b) => b.name.trim()).filter(Boolean);
    if (!names.length) return { error: "Add at least one branch." };
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return { error: "Two branches have the same name." };
    for (const b of input.branches) if (b.from && b.to && b.from > b.to) return { error: `${b.name}: the start date is after the end date.` };
    const config = parseBranches(JSON.stringify(input));
    await setSetting("branches", JSON.stringify(config));
    revalidatePath("/settings", "layout");
    return { ok: "Saved. New messages from Podbean are tagged with these rules." };
  } catch (err) {
    return fail(err);
  }
}

// Gives every message with one place name another (or no branch) a branch.
export async function renameLocation(from: string, to: string): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    if (!to.trim()) return { error: "Pick a branch." };
    const r = await prisma.message.updateMany({ where: { location: from === "" ? null : from }, data: { location: to.trim() } });
    await markSheetDirty();
    revalidatePath("/", "layout");
    return { ok: `${r.count.toLocaleString()} message${r.count === 1 ? "" : "s"} now say ${to.trim()}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function applyBranchRules(): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    const changes = await branchChanges();
    let n = 0;
    for (const [branch, ids] of changes) {
      for (let i = 0; i < ids.length; i += 500) n += (await prisma.message.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data: { location: branch } })).count;
    }
    if (n) await markSheetDirty();
    revalidatePath("/", "layout");
    return { ok: n ? `Updated ${n.toLocaleString()} message${n === 1 ? "" : "s"}.` : "Every message already matches the rules." };
  } catch (err) {
    return fail(err);
  }
}
