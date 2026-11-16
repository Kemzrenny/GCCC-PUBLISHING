import Link from "next/link";
import { after } from "next/server";
import { ChevronLeft, ChevronRight, ListPlus } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { driveConnected } from "@/lib/drive";
import { PageHeading } from "@/components/ui";
import ActionButton from "@/components/ActionButton";
import ManualCard, { DayBlock } from "@/components/glory/ManualCard";
import PlanPanel from "@/components/glory/PlanPanel";
import LineUpPanel from "@/components/glory/LineUpPanel";
import GloryTabs from "@/components/glory/GloryTabs";
import { TONE_DOT } from "@/components/glory/bits";
import { monthView, thisWeek, linedUp, currentMonth, lagosToday, needsProgressCheck } from "@/lib/glory-data";
import { nextToLineUp } from "@/lib/glory-lineup";
import { readLog } from "@/lib/glory-series";
import { readProgress } from "@/lib/glory-drive";
import { addMonths, isMonthKey, monthLabel, monthName, monthKey, folderPath } from "@/lib/glory";
import { formatDate } from "@/lib/dates";
import { STATUS } from "@/lib/status";
import { planDefaults, fillSaturdays, type MessagePick } from "@/app/actions/glory";

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
  const showLineUp = one(sp.add) === "1" && canEdit;

  const [view, week, lined, templates, log] = await Promise.all([
    monthView(key),
    thisWeek(),
    linedUp(key),
    getSettings(["gloryTemplateMembers", "gloryTemplateGuide"]),
    readLog(),
  ]);
  const empty = view.weeks.filter((w) => !w.manual && w.saturday.getTime() >= today.getTime()).length;
  const monthHref = (k: string, extra = "") => `/glory-home?m=${k}${extra}`;
  const nextSat = view.weeks.find((w) => w.saturday.getTime() >= today.getTime())?.saturday.getTime();
  const nextKey = addMonths(key, 1);
  const linedHere = lined.filter((l) => l.plannedMonth && l.plannedMonth <= key);

  // Who has been writing: read the documents again if it's been a while.
  const stale = needsProgressCheck(view.weeks.map((w) => w.manual));
  if (stale.length) after(async () => void ((await driveConnected()) && (await readProgress(stale).catch(() => {}))));

  let preset: MessagePick | null = null;
  if (planDate && presetId) {
    const m = await prisma.message.findUnique({
      where: { id: presetId },
      select: { id: true, title: true, date: true, speaker: true, status: true, location: true, audioUrl: true, sourceUrl: true, _count: { select: { manuals: true } } },
    });
    if (m)
      preset = {
        id: m.id,
        title: m.title,
        date: m.date?.toISOString().slice(0, 10) ?? null,
        speaker: m.speaker,
        branch: m.location,
        status: m.status,
        manuals: m._count.manuals,
        audio: !!(m.audioUrl || m.sourceUrl?.includes("podbean.com/e/")),
      };
  }
  const defaults = planDate && canEdit ? await planDefaults(planDate) : null;
  const lineup = showLineUp ? await nextToLineUp(12) : null;
  const toRow = (m: NonNullable<typeof lineup>["next"][number]) => ({
    id: m.id,
    title: m.title,
    date: m.date?.toISOString().slice(0, 10) ?? null,
    guessedDate: m.dateFromUpload,
    branch: m.location,
    transcribed: m.status !== "NOT_STARTED" && m.status !== "FAILED",
    minutes: m.durationSec ? Math.round(m.durationSec / 60) : null,
  });

  return (
    <>
      <PageHeading eyebrow="Glory Home" title="A manual every Saturday.">
        <GloryTabs active="month" />
      </PageHeading>

      <section aria-label="Month" className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-banner px-5 py-4">
        <div className="flex items-center gap-2">
          <Link href={monthHref(addMonths(key, -1))} aria-label="Previous month" className="btn-quiet h-10 w-10 px-0">
            <ChevronLeft aria-hidden size={18} />
          </Link>
          <span className="min-w-[180px] text-center font-display text-[22px] font-semibold">{monthLabel(key)}</span>
          <Link href={monthHref(nextKey)} aria-label="Next month" className="btn-quiet h-10 w-10 px-0">
            <ChevronRight aria-hidden size={18} />
          </Link>
        </div>
        <span className="flex-1 text-[15px]">
          {view.team ? (
            <>
              <span className="font-semibold">{view.team.name}</span> <span className="text-muted">{key === currentMonth() ? "writing this month" : `write in ${monthName(key)}`}</span>
            </>
          ) : (
            "No team set for this month"
          )}
          {key !== currentMonth() && (
            <Link href="/glory-home" className="ml-3 text-[13px] font-medium text-accent hover:underline">
              Back to this month
            </Link>
          )}
        </span>
        {empty > 0 && <span className="rounded-full bg-[var(--chip-red-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--chip-red)]">{empty} Saturday{empty === 1 ? "" : "s"} without a manual</span>}
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3">
          {view.weeks.map(({ saturday, manual }) => {
            const past = saturday.getTime() < today.getTime();
            const tone = past ? "past" : saturday.getTime() === nextSat ? "next" : "plain";
            if (manual) return <ManualCard key={saturday.toISOString()} m={manual} dayTone={tone} canEdit={canEdit} />;
            const days = Math.round((saturday.getTime() - today.getTime()) / 86_400_000);
            const close = !past && days <= 10;
            return (
              <article key={saturday.toISOString()} className={`flex items-center gap-4 rounded-2xl border-2 border-dashed bg-card p-4 sm:px-5 ${close ? "border-alert/60" : "border-line"}`}>
                <DayBlock date={saturday} tone={past ? "past" : "empty"} />
                <span className={`flex-1 text-[15px] ${close ? "text-alert" : "text-muted"}`}>{past ? "No manual recorded" : days <= 10 ? `No manual yet · ${days === 0 ? "today" : `${days} days away`}` : "No manual yet"}</span>
                {canEdit && (
                  <Link href={monthHref(key, `&plan=${saturday.toISOString().slice(0, 10)}`)} scroll={false} className={past ? "btn-quiet h-10" : "btn-primary h-10"}>
                    {past ? "Record one" : "Plan"}
                  </Link>
                )}
              </article>
            );
          })}
        </div>

        <aside aria-label="To do" className="flex max-w-full flex-[1_1_320px] flex-col gap-4">
          <section className="card flex flex-col gap-2 p-5">
            <h2 className="font-display text-lg font-semibold">To do</h2>
            {week.length === 0 ? (
              <p className="text-sm text-muted">Nothing due in the next three weeks.</p>
            ) : (
              <ul className="flex flex-col">
                {week.slice(0, 6).map((t, i) => (
                  <li key={i} className="flex gap-3 border-t border-line py-2.5">
                    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[t.tone]}`} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {t.manualId ? (
                        <Link href={`/glory-home/manuals/${t.manualId}`} className="text-sm font-medium hover:underline">
                          {t.title}
                        </Link>
                      ) : t.plan && canEdit ? (
                        <Link href={monthHref(monthKey(new Date(`${t.plan}T00:00:00Z`)), `&plan=${t.plan}`)} scroll={false} className="text-sm font-medium hover:underline">
                          {t.title}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{t.title}</span>
                      )}
                      <span className="text-[13px] text-muted">{t.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Lined up{linedHere.length ? ` (${linedHere.length})` : ""}</h2>
              {canEdit && (
                <Link href={monthHref(key, "&add=1")} scroll={false} className="btn-quiet h-9 gap-1.5 px-3 text-[13px]">
                  <ListPlus aria-hidden size={16} /> Line up next
                </Link>
              )}
            </div>
            {linedHere.length === 0 ? (
              <p className="text-sm text-muted">Nothing lined up for {monthName(key)}. Line up the next messages, then give them this month’s Saturdays.</p>
            ) : (
              <>
                <ul className="flex flex-col">
                  {linedHere.slice(0, 6).map((l) => (
                    <li key={l.id} className="flex flex-col gap-0.5 border-t border-line py-2">
                      {l.message ? (
                        <Link href={`/messages/${l.message.id}`} className="truncate text-sm font-medium hover:underline">
                          {l.message.title}
                        </Link>
                      ) : (
                        <Link href={`/glory-home/manuals/${l.id}`} className="truncate text-sm font-medium hover:underline">
                          {l.sourceTitle ?? "A sermon not in the library yet"}
                        </Link>
                      )}
                      <span className="text-xs text-muted">
                        {[l.message ? formatDate(l.message.date) : null, l.message?.location, l.plannedMonth && l.plannedMonth < key ? "from an earlier month" : null, l.message ? STATUS[l.message.status].label : "Not matched"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
                {linedHere.length > 6 && (
                  <Link href="/glory-home/manuals?show=lined" className="text-[13px] font-medium text-accent hover:underline">
                    See all {linedHere.length}
                  </Link>
                )}
                {canEdit && empty > 0 && (
                  <ActionButton action={fillSaturdays.bind(null, key)} className="btn-primary h-10 text-[13px]" pendingLabel="Planning…">
                    Give them {monthName(key)}’s {Math.min(empty, linedHere.length)} free Saturday{Math.min(empty, linedHere.length) === 1 ? "" : "s"}
                  </ActionButton>
                )}
              </>
            )}
          </section>

          {log.length > 0 && (
            <details className="card p-5">
              <summary className="cursor-pointer font-display text-lg font-semibold">Recent changes</summary>
              <ul className="mt-2 flex flex-col">
                {log.slice(0, 6).map((e, i) => (
                  <li key={i} className="border-t border-line py-2 text-[13px]">
                    <span className="text-muted">
                      {formatDate(e.at)} · {e.by}:
                    </span>{" "}
                    {e.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
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
      {lineup && (
        <LineUpPanel
          speaker={lineup.speaker}
          last={lineup.last ? { title: lineup.last.title, date: lineup.last.date?.toISOString().slice(0, 10) ?? null } : null}
          next={lineup.next.map(toRow)}
          skipped={lineup.skipped.map(toRow)}
          skippedCount={lineup.skippedCount}
          months={[0, 1, 2].map((i) => addMonths(key, i)).map((k) => ({ key: k, label: monthLabel(k) }))}
          defaultMonth={key}
          closeHref={monthHref(key)}
        />
      )}
    </>
  );
}
