"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { markSheetDirty, setSetting, getSettings } from "@/lib/settings";
import { createManualDocs, shareWithTeam } from "@/lib/glory-drive";
import { gloryConfig } from "@/lib/glory-config";
import { STAGES, nextStage, manualCode, monthKey, teamFor, isMonthKey, type Stage, type Team } from "@/lib/glory";
import { kickRunner, enqueue } from "@/lib/jobs";
import type { ActionResult } from "@/app/actions/messages";

const WRITERS = ["ADMIN", "REVIEWER", "WRITER"] as const;
const fail = (err: unknown): ActionResult => ({ error: err instanceof Error ? err.message : "Something went wrong." });
const refresh = () => revalidatePath("/", "layout");

// ---- Finding a message to write from ----

export type MessagePick = { id: string; title: string; date: string | null; speaker: string | null; status: string; manuals: number; audio: boolean };

export async function searchMessages(q: string): Promise<MessagePick[]> {
  await requireUser([...WRITERS]);
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return [];
  const rows = await prisma.message.findMany({
    where: { AND: words.map((w) => ({ OR: [{ title: { contains: w, mode: "insensitive" as const } }, { speaker: { contains: w, mode: "insensitive" as const } }] })) },
    orderBy: [{ date: { sort: "desc", nulls: "last" } }],
    take: 8,
    select: { id: true, title: true, date: true, speaker: true, status: true, audioUrl: true, sourceUrl: true, _count: { select: { manuals: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    date: m.date?.toISOString().slice(0, 10) ?? null,
    speaker: m.speaker,
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
  part: z.coerce.number().int().min(1).max(20),
  parts: z.coerce.number().int().min(1).max(20),
  title: z.string().trim().max(200),
  membersWriter: z.string().trim().max(80),
  guideWriter: z.string().trim().max(80),
  createDocs: z.boolean(),
  lineUpId: z.string().optional(),
});

export type PlanInput = z.input<typeof planSchema>;

function defaultWriters(team: Team | null) {
  return { membersWriter: team?.members[0]?.name ?? null, guideWriter: team?.members[1]?.name ?? team?.members[0]?.name ?? null };
}

export async function planManual(input: PlanInput): Promise<{ ok?: string; error?: string; id?: string }> {
  try {
    await requireUser([...WRITERS]);
    const p = planSchema.parse(input);
    if (p.part > p.parts) return { error: "The part can't be more than the number of parts." };
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
        part: p.parts > 1 ? p.part : null,
        parts: p.parts > 1 ? p.parts : null,
        membersWriter: p.membersWriter || null,
        guideWriter: p.guideWriter || null,
        source: "portal",
      },
    });
    // A message lined up for the month is now planned.
    if (p.lineUpId) await prisma.manual.deleteMany({ where: { id: p.lineUpId, saturday: null, number: null } });

    // The other parts go on the next free Saturdays, with the next numbers, for whichever
    // team has that month.
    const { teams, rotation } = await gloryConfig();
    let next = saturday;
    let number = p.number;
    for (let part = p.part + 1; part <= p.parts; part++) {
      do next = new Date(next.getTime() + 7 * 86_400_000);
      while (await prisma.manual.findFirst({ where: { saturday: next }, select: { id: true } }));
      do number++;
      while (await prisma.manual.findFirst({ where: { number }, select: { id: true } }));
      await prisma.manual.create({
        data: {
          messageId: p.messageId,
          number,
          code: manualCode(number),
          saturday: next,
          stage: "PLANNED",
          part,
          parts: p.parts,
          ...defaultWriters(teamFor(monthKey(next), teams, rotation)),
          source: "portal",
        },
      });
    }

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
    return { ok: `Planned ${manualCode(p.number)}${p.parts > p.part ? ` and the other ${p.parts - p.part} part${p.parts - p.part === 1 ? "" : "s"}` : ""}.${note}`, id: manual.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong." };
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
  stage: z.enum(STAGES),
  part: z.string().trim().regex(/^\d{0,2}$/),
  parts: z.string().trim().regex(/^\d{0,2}$/),
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
    await prisma.manual.update({
      where: { id },
      data: {
        title: d.title || null,
        number,
        code: manualCode(number),
        saturday,
        plannedMonth: saturday ? null : isMonthKey(d.plannedMonth) ? d.plannedMonth : null,
        stage: d.stage,
        part: d.part ? Number(d.part) : null,
        parts: d.parts ? Number(d.parts) : null,
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

// Lines a message up for a month's team without a Saturday yet.
export async function lineUpMessage(messageId: string, month: string): Promise<ActionResult> {
  try {
    await requireUser([...WRITERS]);
    if (!isMonthKey(month)) return { error: "Pick a month." };
    const exists = await prisma.manual.findFirst({ where: { messageId, saturday: null, number: null } });
    if (exists) await prisma.manual.update({ where: { id: exists.id }, data: { plannedMonth: month } });
    else await prisma.manual.create({ data: { messageId, plannedMonth: month, stage: "PLANNED", source: "portal" } });
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

