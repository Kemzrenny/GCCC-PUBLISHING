import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PageHeading } from "@/components/ui";
import ActionButton from "@/components/ActionButton";
import ManualCard, { DayBlock } from "@/components/glory/ManualCard";
import PlanPanel from "@/components/glory/PlanPanel";
import GloryTabs from "@/components/glory/GloryTabs";
import { TONE_DOT } from "@/components/glory/bits";
import { monthView, thisWeek, linedUp, currentMonth, lagosToday } from "@/lib/glory-data";
import { addMonths, isMonthKey, monthLabel, monthName, monthKey, shortDay, folderPath, longDate, STAGES } from "@/lib/glory";
import { formatDate } from "@/lib/dates";
import { STATUS } from "@/lib/status";
import { transcribeForManual, planDefaults, type MessagePick } from "@/app/actions/glory";

export const metadata = { title: "Glory Home" };
export const maxDuration = 120;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function GloryHomePage({ searchParams }: PageProps<"/glory-home">) {
  const user = await currentUser();
  const canEdit = user.role !== "VIEWER";
  const sp = await searchParams;
  const today = lagosToday();
  const key = isMonthKey(one(sp.m)) ? one(sp.m)! : currentMonth();
  const planDate = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.plan) ?? "") ? one(sp.plan)! : null;
  const presetId = one(sp.message) ?? null;
  const lineUpId = one(sp.lineup) ?? null;

  const [view, week, lined, templates] = await Promise.all([
    monthView(key),
    thisWeek(),
    linedUp(key),
    getSettings(["gloryTemplateMembers", "gloryTemplateGuide"]),
  ]);
  const planned = view.weeks.filter((w) => w.manual);
  const counts = STAGES.map((s) => ({ s, n: planned.filter((w) => w.manual!.stage === s).length }));
  const empty = view.weeks.filter((w) => !w.manual && w.saturday.getTime() >= today.getTime()).length;
  const monthHref = (k: string, extra = "") => `/glory-home?m=${k}${extra}`;
  const nextSat = view.weeks.find((w) => w.saturday.getTime() >= today.getTime())?.saturday.getTime();

  let preset: MessagePick | null = null;
  if (planDate && presetId) {
    const m = await prisma.message.findUnique({
      where: { id: presetId },
      select: { id: true, title: true, date: true, speaker: true, status: true, audioUrl: true, sourceUrl: true, _count: { select: { manuals: true } } },
    });
    if (m)
      preset = {
        id: m.id,
        title: m.title,
        date: m.date?.toISOString().slice(0, 10) ?? null,
        speaker: m.speaker,
        status: m.status,
        manuals: m._count.manuals,
        audio: !!(m.audioUrl || m.sourceUrl?.includes("podbean.com/e/")),
      };
  }
  const defaults = planDate && canEdit ? await planDefaults(planDate) : null;
  const nextKey = addMonths(key, 1);

  return (
    <>
      <PageHeading eyebrow="Glory Home" title="A manual every Saturday." lead="Plan each week’s manual from a message, write it from the templates, and follow it to the Glory Homes.">
        <GloryTabs active="month" />
      </PageHeading>

      <section aria-label="Month" className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl bg-banner px-6 py-5">
        <div className="flex items-center gap-2">
          <Link href={monthHref(addMonths(key, -1))} aria-label="Previous month" className="btn-quiet h-11 w-11 px-0">
            <ChevronLeft aria-hidden size={18} />
          </Link>
          <span className="min-w-[200px] text-center font-display text-[26px] font-semibold">{monthLabel(key)}</span>
          <Link href={monthHref(nextKey)} aria-label="Next month" className="btn-quiet h-11 w-11 px-0">
            <ChevronRight aria-hidden size={18} />
          </Link>
        </div>
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <span className="text-[15px]">
            {view.team ? (
              <>
                <span className="font-semibold">{view.team.name}</span> {key === currentMonth() ? "are writing this month" : `write in ${monthName(key)}`}
              </>
            ) : (
              "No team set for this month"
            )}
          </span>
          <span className="text-[13px] text-muted">
            {monthName(nextKey)}: {view.nextTeam?.name ?? "no team set"}
            {key !== currentMonth() && (
              <>
                {" · "}
                <Link href="/glory-home" className="font-medium text-accent hover:underline">Back to this month</Link>
              </>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {counts
            .filter((c) => c.n)
            .map((c) => (
              <span key={c.s} className="rounded-full bg-card px-3 py-1.5 text-[13px]">
                <strong>{c.n}</strong> {c.s === "SENT" ? "with the secretariat" : c.s.toLowerCase()}
              </span>
            ))}
          {empty > 0 && (
            <span className="rounded-full bg-[var(--chip-red-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--chip-red)]">
              {empty} not planned
            </span>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          {view.weeks.map(({ saturday, manual }) => {
            const past = saturday.getTime() < today.getTime();
            const tone = past ? "past" : saturday.getTime() === nextSat ? "next" : "plain";
            if (manual) return <ManualCard key={saturday.toISOString()} m={manual} dayTone={tone} canEdit={canEdit} />;
            const days = Math.round((saturday.getTime() - today.getTime()) / 86_400_000);
            return (
              <article
                key={saturday.toISOString()}
                className={`flex flex-wrap items-center gap-5 rounded-2xl border-2 border-dashed p-5 sm:px-6 ${!past && days <= 10 ? "border-alert/60" : "border-line"} bg-card`}
              >
                <DayBlock date={saturday} tone={past ? "past" : "empty"} />
                <div className="flex flex-[1_1_300px] flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-display text-xl font-semibold">{past ? "No manual recorded" : "No manual planned yet"}</span>
                    <span className={`text-[13px] ${!past && days <= 10 ? "text-alert" : "text-muted"}`}>
                      {past ? "Nothing was filed for this Saturday." : `${days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days away`} · ${view.team?.name ?? "No team"}`}
                    </span>
                  </div>
                  {canEdit && (
                    <Link href={monthHref(key, `&plan=${saturday.toISOString().slice(0, 10)}`)} scroll={false} className={past ? "btn-quiet h-11" : "btn-primary h-11"}>
                      {past ? "Record one" : "Plan this Saturday"}
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <aside aria-label="This week" className="flex max-w-full flex-[1_1_340px] flex-col gap-4">
          <section className="card flex flex-col gap-3 p-5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-accent">{longDate(today).replace(/^\d+ /, (d) => `${shortDay(today).split(" ")[0]} ${d}`)}</span>
              <h2 className="font-display text-[22px] font-semibold">This week</h2>
            </div>
            {week.length === 0 ? (
              <p className="text-sm text-muted">Nothing due in the next three weeks.</p>
            ) : (
              <ul className="flex flex-col">
                {week.map((t, i) => (
                  <li key={i} className="flex gap-3 border-t border-line py-3">
                    <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TONE_DOT[t.tone]}`} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {t.manualId ? (
                        <Link href={`/glory-home/manuals/${t.manualId}`} className="text-sm font-medium hover:underline">{t.title}</Link>
                      ) : (
                        <span className="text-sm font-medium">{t.title}</span>
                      )}
                      <span className="text-[13px] text-muted">{t.detail}</span>
                      {t.plan && canEdit && (
                        <Link href={monthHref(monthKey(new Date(`${t.plan}T00:00:00Z`)), `&plan=${t.plan}`)} scroll={false} className="mt-1 self-start text-[13px] font-medium text-accent hover:underline">
                          Plan it
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Lined up</h2>
              <span className="text-[13px] text-muted">Messages chosen, no Saturday yet</span>
            </div>
            {lined.length === 0 ? (
              <p className="text-sm text-muted">Nothing lined up. Pick messages from the library, or plan a Saturday straight away.</p>
            ) : (
              lined.slice(0, 8).map((l) => {
                const untranscribed = l.message && (l.message.status === "NOT_STARTED" || l.message.status === "FAILED");
                const firstFree = view.weeks.find((w) => !w.manual && w.saturday.getTime() >= today.getTime())?.saturday;
                return (
                  <div key={l.id} className="flex items-center justify-between gap-3 border-t border-line pt-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {l.message ? (
                        <Link href={`/messages/${l.message.id}`} className="truncate text-sm font-medium hover:underline">{l.message.title}</Link>
                      ) : (
                        <Link href={`/glory-home/manuals/${l.id}`} className="truncate text-sm font-medium hover:underline">{l.sourceTitle ?? "A sermon not in the library yet"}</Link>
                      )}
                      <span className="text-xs text-muted">
                        {[
                          l.plannedMonth ? `${monthName(l.plannedMonth)}${l.plannedMonth < key ? " (earlier)" : ""}` : null,
                          [l.membersWriter, l.guideWriter !== l.membersWriter ? l.guideWriter : null].filter(Boolean).join(" & ") || null,
                          l.message ? STATUS[l.message.status].label : "Not matched",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {canEdit && l.message && (
                      untranscribed ? (
                        <ActionButton action={transcribeForManual.bind(null, l.message.id)} className="btn-quiet h-9 shrink-0 px-3 text-[13px]" pendingLabel="Queueing…">
                          Transcribe
                        </ActionButton>
                      ) : firstFree ? (
                        <Link
                          href={monthHref(key, `&plan=${firstFree.toISOString().slice(0, 10)}&message=${l.message.id}&lineup=${l.id}`)}
                          scroll={false}
                          className="btn-quiet h-9 shrink-0 px-3 text-[13px]"
                        >
                          Plan
                        </Link>
                      ) : null
                    )}
                  </div>
                );
              })
            )}
            {lined.length > 8 && (
              <Link href="/glory-home/manuals?show=lined" className="text-[13px] font-medium text-accent hover:underline">
                See all {lined.length} lined up
              </Link>
            )}
          </section>
        </aside>
      </div>

      {planDate && defaults && (
        <PlanPanel
          saturday={planDate}
          label={`Saturday ${formatDate(new Date(`${planDate}T00:00:00Z`))}`}
          teamName={defaults.team}
          members={defaults.members}
          defaults={defaults}
          preset={preset}
          lineUpId={lineUpId}
          closeHref={monthHref(key)}
          templatesReady={!!(templates.gloryTemplateMembers && templates.gloryTemplateGuide)}
          folder={folderPath(new Date(`${planDate}T00:00:00Z`)).join(" › ")}
        />
      )}
    </>
  );
}

