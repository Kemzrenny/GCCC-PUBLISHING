"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { mergeSpeakers } from "@/lib/speakers";
import type { ActionResult } from "./messages";

const plural = (n: number) => `${n} message${n === 1 ? "" : "s"}`;

export async function merge(target: string, variants: string[]): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    if (!target.trim()) return { error: "Choose the name to keep." };
    const moved = await mergeSpeakers(target, variants);
    revalidatePath("/", "layout");
    return { ok: `Done. ${plural(moved)} now show ${target.trim()}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function notASpeaker(name: string): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    const moved = await mergeSpeakers(null, [name]);
    revalidatePath("/", "layout");
    return { ok: `Removed from ${plural(moved)}. Future imports will leave it blank too.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
