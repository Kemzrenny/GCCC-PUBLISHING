"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { markSheetDirty, setSetting, getSettings } from "@/lib/settings";
import { createManualDocs, shareWithTeam, retitleManualDocs, readProgress } from "@/lib/glory-drive";
import { changeParts, previewNew, previewParts, describe, defaultWriters, logChange } from "@/lib/glory-series";
import { lineUp, fillMonth, reorderQueue, removeFromQueue } from "@/lib/glory-lineup";
import { outlineSections, geminiConfigured } from "@/lib/gemini";
import { gloryConfig } from "@/lib/glory-config";
import { STAGES, nextStage, manualCode, monthKey, teamFor, isMonthKey, shortDay, type Stage } from "@/lib/glory";
import { kickRunner, enqueue } from "@/lib/jobs";
import type { ActionResult } from "@/app/actions/messages";

const WRITERS = ["ADMIN", "REVIEWER", "WRITER"] as const;
const fail = (err: unknown): ActionResult => ({ error: err instanceof Error ? err.message : "Something went wrong." });
const refresh = () => revalidatePath("/", "layout");

// ---- Finding a message to write from ----

export type MessagePick = { id: string; title: string; date: string | null; speaker: string | null; branch: string | null; status: string; manuals: number; audio: boolean };

export async function searchMessages(q: string): Promise<MessagePick[]> {
  await requireUser([...WRITERS]);
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return [];
  const rows = await prisma.message.findMany({
    where: { AND: words.map((w) => ({ OR: [{ title: { contains: w, mode: "insensitive" as const } }, { speaker: { contains: w, mode: "insensitive" as const } }] })) },
    orderBy: [{ date: { sort: "desc", nulls: "last" } }],
    take: 8,
    select: { id: true, title: true, date: true, speaker: true, location: true, status: true, audioUrl: true, sourceUrl: true, _count: { select: { manuals: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    date: m.date?.toISOString().slice(0, 10) ?? null,
    speaker: m.speaker,
    branch: m.location,
    status: m.status,
    manuals: m._count.manuals,
    audio: !!(m.audioUrl || m.sourceUrl?.includes("podbean.com/e/")),
  }));
}

export async function transcribeForManual(messageId: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    const queued = await enqueue([messageId], { force: true });
    if (!queued) return { error: "This message has no Podbean audio to transcribe, or it's already being transcribed." };
    after(kickRunner);
    return { ok: "Transcribing. It takes about 10 minutes." };
  } catch (err) {
    return fail(err);
  }
}

// ---- Planning ----

const planSchema = z.object({
  saturday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  messageId: z.string().min(1, "Pick the message the manual comes from."),
  number: z.coerce.number().int().min(1).max(99999),
  // 0: the writers will say how many manuals it makes.
  parts: z.coerce.number().int().min(0).max(8),
  title: z.string().trim().max(200),
  membersWriter: z.string().trim().max(80),
  guideWriter: z.string().trim().max(80),
  createDocs: z.boolean(),
  lineUpId: z.string().optional(),
});

export type PlanInput = z.input<typeof planSchema>;

export async function planManual(input: PlanInput): Promise<{ ok?: string; error?: string; id?: string }> {
  try {
    const user = await requireUser([...WRITERS]);
    const p = planSchema.parse(input);
    const saturday = new Date(`${p.saturday}T00:00:00Z`);
    if (saturday.getUTCDay() !== 6) return { error: "Glory Home manuals are for Saturdays." };
    const taken = await prisma.manual.findFirst({ where: { saturday }, select: { code: true, title: true } });
    if (taken) return { error: `That Saturday already has ${taken.code ?? taken.title ?? "a manual"}.` };
    const clash = await prisma.manual.findFirst({ where: { number: p.number }, select: { id: true } });
    if (clash) return { error: `${manualCode(p.number)} is already used. Pick another number.` };

    const manual = await prisma.manual.create({
      data: {
        messageId: p.messageId,
        number: p.number,
        code: manualCode(p.number),
        title: p.title || null,
        saturday,
        stage: "PLANNED",
        partsConfirmed: p.parts > 0,
        membersWriter: p.membersWriter || null,
        guideWriter: p.guideWriter || null,
        source: "portal",
      },
    });
    await prisma.manual.update({ where: { id: manual.id }, data: { seriesId: manual.id } });
    // The message was lined up: it's planned now.
    await prisma.manual.deleteMany({ where: { OR: [{ id: p.lineUpId ?? "" }, { messageId: p.messageId }], saturday: null, number: null } });

    let moved = "";
    if (p.parts > 1) moved = ` ${(await changeParts(manual.id, p.parts, user.name)).note}`;

    let note = "";
    if (p.createDocs) {
      try {
        const { filled } = await createManualDocs(manual.id);
        if (!filled) note = " The documents were made, but their header couldn't be filled in: turn on the Google Docs API (see Settings).";
      } catch (err) {
        note = ` The documents weren't made: ${err instanceof Error ? err.message : "Drive didn't answer."}`;
      }
    }
    await markSheetDirty();
    refresh();
    return { ok: `Planned ${manualCode(p.number)}.${moved}${note}`, id: manual.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// For the plan panel: where the other parts would go, and what would move.
export async function previewPlan(saturday: string, number: number, parts: number): Promise<string[]> {
  await requireUser([...WRITERS]);
  if (parts <= 1 || !/^\d{4}-\d{2}-\d{2}$/.test(saturday)) return [];
  const { plan, titles } = await previewNew(new Date(`${saturday}T00:00:00Z`), number, parts);
  const lines = plan.add.map((a) => `Part ${a.part}: ${shortDay(a.saturday)}${a.number ? `, ${manualCode(a.number)}` : ""}`);
  const moved = plan.moves.filter((m) => m.from.getTime() !== m.to.getTime());
  if (moved.length) {
    lines.push(
      `${moved.length} later manual${moved.length === 1 ? " moves" : "s move"} back: ${moved
        .map((m) => `${manualCode(m.oldNumber) ?? titles.get(m.id)?.title ?? "one"} to ${shortDay(m.to)}`)
        .join(", ")}`,
    );
  }
  return lines;
}

// The writers say how many manuals a message makes; the calendar moves to match.
export async function setParts(manualId: string, total: number): Promise<ActionResult> {
  try {
    const user = await requireUser([...WRITERS]);
    if (!Number.isInteger(total) || total < 1 || total > 8) return { error: "Pick between 1 and 8." };
    const { note, moved } = await changeParts(manualId, total, user.name);
    after(async () => {
      for (const m of moved) await retitleManualDocs(m.id, { number: m.number, saturday: m.saturday }).catch(() => {});
    });
    refresh();
    return { ok: note || `Confirmed: ${total} manual${total === 1 ? "" : "s"}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function previewSetParts(manualId: string, total: number): Promise<string> {
  await requireUser([...WRITERS]);
  const { plan } = await previewParts(manualId, total);
  if (plan.error) return plan.error;
  const rows = await prisma.manual.findMany({ where: { id: { in: plan.moves.map((m) => m.id) } }, select: { id: true, number: true, title: true } });
  return describe(plan, new Map(rows.map((r) => [r.id, r])));
}

// ---- Lining up ----

export async function lineUpNext(messageIds: string[], transcribe: boolean): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    if (!messageIds.length) return { error: "Tick the messages to line up." };
    const ids = messageIds.slice(0, 40);
    await lineUp(ids);
    let queued = 0;
    if (transcribe) {
      queued = await enqueue(ids, {});
      if (queued) after(kickRunner);
    }
    refresh();
    return { ok: `Lined up ${ids.length} message${ids.length === 1 ? "" : "s"}.${queued ? ` Transcribing ${queued} of them.` : ""}` };
  } catch (err) {
    return fail(err);
  }
}

export async function reorderLinedUp(ids: string[]): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    await reorderQueue(ids.slice(0, 200));
    refresh();
    return { ok: "Order saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function removeLinedUp(id: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    await removeFromQueue(id);
    refresh();
    return { ok: "Removed." };
  } catch (err) {
    return fail(err);
  }
}

export async function fillSaturdays(month: string): Promise<ActionResult> {
  try {
    const user = await requireUser([...WRITERS]);
    if (!isMonthKey(month)) return { error: "Pick a month." };
    const { planned, free } = await fillMonth(month);
    if (!free) return { error: "This month has no free Saturdays left." };
    if (!planned) return { error: "Nothing is lined up to plan. Line up some messages first." };
    await logChange({ by: user.name, text: `Planned ${planned} lined-up message${planned === 1 ? "" : "s"} into ${month}'s free Saturdays.` });
    await markSheetDirty();
    refresh();
    return { ok: `Planned ${planned} of ${free} free Saturday${free === 1 ? "" : "s"}. The writers confirm how many manuals each makes.` };
  } catch (err) {
    return fail(err);
  }
}

// The message's main sections, as a hint for how many manuals it makes.
export async function outlineMessage(messageId: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    if (!geminiConfigured()) return { error: "Gemini isn't set up." };
    const m = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { title: true, transcript: { select: { text: true } } } });
    if (!m.transcript?.text) return { error: "Transcribe the message first." };
    const sections = await outlineSections(m.transcript.text, { title: m.title });
    await prisma.message.update({ where: { id: messageId }, data: { sections } });
    refresh();
    return { ok: `${sections.length} main section${sections.length === 1 ? "" : "s"}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function setStage(id: string, stage: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    if (!(STAGES as readonly string[]).includes(stage)) return { error: "Pick a status." };
    await prisma.manual.update({ where: { id }, data: { stage: stage as Stage } });
    await markSheetDirty();
    refresh();
    return { ok: "Updated." };
  } catch (err) {
    return fail(err);
  }
}

export async function checkProgress(ids: string[]): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    await readProgress(ids.slice(0, 20));
    refresh();
    return { ok: "Checked the documents." };
  } catch (err) {
    return fail(err);
  }
}

// Suggestions for the plan panel: the next free number, and the month's team.
export async function planDefaults(saturday: string) {
  await requireUser([...WRITERS]);
  const d = new Date(`${saturday}T00:00:00Z`);
  const top = await prisma.manual.aggregate({ _max: { number: true } });
  const { teams, rotation } = await gloryConfig();
  const team = teamFor(monthKey(d), teams, rotation);
  return { number: (top._max.number ?? 0) + 1, team: team?.name ?? null, members: team?.members.map((m) => m.name) ?? [], ...defaultWriters(team) };
}

// ---- Moving a manual along ----

export async function advanceManual(id: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    const m = await prisma.manual.findUniqueOrThrow({ where: { id } });
    const to = nextStage(m.stage as Stage);
    if (!to) return { ok: "Already taught." };
    await prisma.manual.update({ where: { id }, data: { stage: to } });
    await markSheetDirty();
    refresh();
    return { ok: "Updated." };
  } catch (err) {
    return fail(err);
  }
}

export async function makeDocs(id: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    const { filled } = await createManualDocs(id);
    refresh();
    return { ok: filled ? "Documents ready in the Glory Home folder." : "Documents made. Turn on the Google Docs API to fill in their header automatically." };
  } catch (err) {
    return fail(err);
  }
}

const editSchema = z.object({
  title: z.string().trim().max(200),
  number: z.string().trim().regex(/^\d{0,5}$/, "The manual number is just digits."),
  saturday: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  plannedMonth: z.string().trim(),
  membersWriter: z.string().trim().max(80),
  guideWriter: z.string().trim().max(80),
  membersUrl: z.string().trim().max(500),
  guideUrl: z.string().trim().max(500),
  notes: z.string().trim().max(2000),
});

export async function saveManual(id: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    const raw = Object.fromEntries(Object.keys(editSchema.shape).map((k) => [k, String(form.get(k) ?? "")]));
    const parsed = editSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    const number = d.number ? Number(d.number) : null;
    if (number) {
      const clash = await prisma.manual.findFirst({ where: { number, NOT: { id } }, select: { id: true } });
      if (clash) return { error: `${manualCode(number)} is already used by another manual.` };
    }
    const saturday = d.saturday ? new Date(`${d.saturday}T00:00:00Z`) : null;
    if (saturday) {
      const clash = await prisma.manual.findFirst({ where: { saturday, NOT: { id } }, select: { code: true } });
      if (clash) return { error: `That Saturday already has ${clash.code ?? "a manual"}.` };
    }
    const url = (s: string) => (s && /^https?:\/\//i.test(s) ? s : null);
    const before = await prisma.manual.findUniqueOrThrow({ where: { id } });
    if ((before.number !== number || before.saturday?.getTime() !== saturday?.getTime()) && (before.membersDocId || before.guideDocId)) {
      after(() => retitleManualDocs(id, { number: before.number, saturday: before.saturday }).catch(() => {}));
    }
    await prisma.manual.update({
      where: { id },
      data: {
        title: d.title || null,
        number,
        code: manualCode(number),
        saturday,
        plannedMonth: saturday ? null : isMonthKey(d.plannedMonth) ? d.plannedMonth : null,
        membersWriter: d.membersWriter || null,
        guideWriter: d.guideWriter || null,
        // Links to our own documents stay; other links can be pasted in.
        membersUrl: before.membersDocId ? before.membersUrl : url(d.membersUrl),
        guideUrl: before.guideDocId ? before.guideUrl : url(d.guideUrl),
        notes: d.notes || null,
      },
    });
    await markSheetDirty();
    refresh();
    return { ok: "Saved." };
  } catch (err) {
    return fail(err);
  }
}

export async function linkManualMessage(id: string, messageId: string | null): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    await prisma.manual.update({ where: { id }, data: { messageId } });
    await markSheetDirty();
    refresh();
    return { ok: messageId ? "Linked to the message." : "Unlinked." };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteManual(id: string): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN", "REVIEWER"]);
    await prisma.manual.delete({ where: { id } });
    await markSheetDirty();
    refresh();
  } catch (err) {
    return fail(err);
  }
  // Outside the try: redirect works by throwing.
  redirect("/glory-home/manuals");
}

// Adds one message to the end of the lined-up queue (from the message's page).
export async function lineUpMessage(messageId: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    await lineUp([messageId]);
    refresh();
    return { ok: "Lined up." };
  } catch (err) {
    return fail(err);
  }
}

// ---- Settings ----

const teamsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(20),
      name: z.string().trim().min(1, "Give each team a name.").max(80),
      members: z.array(z.object({ name: z.string().trim().max(60), email: z.string().trim().max(200) })).max(6),
    }),
  )
  .min(1)
  .max(4);

export async function saveGlorySettings(input: { teams: unknown; anchorMonth: string; anchorTeam: string; overrides: Record<string, string> }): Promise<ActionResult> {
  try {
    await requireUser(["ADMIN"]);
    const teams = teamsSchema.parse(input.teams).map((t) => ({ ...t, members: t.members.filter((m) => m.name) }));
    for (const t of teams) for (const m of t.members) if (m.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email)) return { error: `${m.email} isn't an email address.` };
    if (!isMonthKey(input.anchorMonth) || !teams.some((t) => t.id === input.anchorTeam)) return { error: "Pick which team has which month." };
    const overrides = Object.fromEntries(Object.entries(input.overrides).filter(([k, v]) => isMonthKey(k) && teams.some((t) => t.id === v)));
    await setSetting("gloryTeams", JSON.stringify(teams));
    await setSetting("gloryRotation", JSON.stringify({ anchorMonth: input.anchorMonth, anchorTeam: input.anchorTeam, overrides }));
    let shared = "";
    const s = await getSettings(["driveRefreshToken"]);
    if (s.driveRefreshToken) {
      try {
        const r = await shareWithTeam();
        if (r.shared.length) shared = ` Shared the Glory Home folder with ${r.shared.join(", ")}.`;
      } catch (err) {
        shared = ` Couldn't share the folder: ${err instanceof Error ? err.message : "Drive didn't answer."}`;
      }
    }
    refresh();
    return { ok: `Saved.${shared}` };
  } catch (err) {
    return fail(err);
  }
}

