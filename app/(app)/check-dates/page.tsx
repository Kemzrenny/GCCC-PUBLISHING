import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, canReview } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isoDay } from "@/lib/dates";
import { titleKnown } from "@/lib/needs";
import { PageHeading, Empty } from "@/components/ui";
import DetailsForm from "@/components/DetailsForm";
import ActionButton from "@/components/ActionButton";
import DateCheck from "@/components/DateCheck";
import { checkPodbeanNow } from "@/app/actions/messages";
import { getSetting } from "@/lib/settings";
import { checkDateCounts, checkDateGroups } from "@/lib/check-dates";
import type { PodbeanResult } from "@/lib/podbean";

export const metadata = { title: "Check dates" };

export default async function CheckDatesPage({ searchParams }: PageProps<"/check-dates">) {
  const user = await currentUser();
  if (!canReview(user.role)) redirect("/library");
  const sp = await searchParams;
  const order = sp.order === "used" ? "used" : "day";
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);

  const [untitled, waiting, speakers, counts, { groups, pages }] = await Promise.all([
    prisma.message.findMany({ where: { needsDetails: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 20 }),
    prisma.message.count({ where: { needsDetails: true } }),
    prisma.message.groupBy({ by: ["speaker"], orderBy: { _count: { speaker: "desc" } }, take: 30 }),
    checkDateCounts(),
    checkDateGroups(order, page),
  ]);
  let last: PodbeanResult | null = null;
  try {
    last = JSON.parse((await getSetting("podbeanLastResult")) || "null");
  } catch {}
  const report = last?.report;
  const speakerNames = speakers.map((s) => s.speaker).filter((s): s is string => !!s);
  const { toCheck, checked } = counts;
  const pct = toCheck + checked ? Math.round((checked / (toCheck + checked)) * 100) : 100;
  const href = (o: string, p = 1) => `/check-dates?order=${o}${p > 1 ? `&page=${p}` : ""}`;

  return (
    <>
      <PageHeading
        eyebrow="Check dates"
        title="Is this when it was preached?"
        lead="Messages with no date in their title use the day they went up on Podbean, and that date is already in use. If you know a message was preached on a different day, correct it here whenever you have time. Nothing is waiting on this."
      />

      {toCheck + checked > 0 && (
        <section aria-label="Progress" className="flex flex-wrap items-center gap-5 rounded-2xl bg-banner px-6 py-5">
          <div className="flex min-w-72 flex-1 flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-2xl font-semibold">{toCheck.toLocaleString()} using the upload date</span>
              <span className="text-[15px] text-muted">· {checked.toLocaleString()} confirmed or corrected</span>
            </div>
            <div role="img" aria-label={`${pct}% checked`} className="h-1.5 rounded-full bg-track">
              <div className="h-1.5 rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <nav aria-label="Order" className="flex gap-0.5 rounded-[10px] bg-card p-1">
            <Link href={href("used")} aria-current={order === "used" ? "page" : undefined} className={`flex h-10 items-center rounded-lg px-3.5 text-[13px] font-medium ${order === "used" ? "bg-nav-on text-ink" : "text-muted hover:text-ink"}`}>
              Most used first
            </Link>
            <Link href={href("day")} aria-current={order === "day" ? "page" : undefined} className={`flex h-10 items-center rounded-lg px-3.5 text-[13px] font-medium ${order === "day" ? "bg-nav-on text-ink" : "text-muted hover:text-ink"}`}>
              By upload day
            </Link>
          </nav>
        </section>
      )}

      {waiting > 0 && (
        <section aria-labelledby="needs-title" className="card flex flex-col gap-4 p-5 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="needs-title" className="font-display text-xl font-semibold">
              {waiting.toLocaleString()} need{waiting === 1 ? "s" : ""} a title or date
            </h2>
            <span className="text-[13px] text-muted">Podbean had nothing usable. Listen to the start and fill them in.</span>
          </div>
          {report && <WhyWaiting report={report} feedEpisodes={last?.checked ?? 0} />}
          {untitled.map((m) => (
            <div key={m.id} className="flex flex-col gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link href={`/messages/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                {m.audioUrl && <audio controls preload="none" src={m.audioUrl} className="h-10 w-full max-w-sm" />}
              </div>
              <DetailsForm
                messageId={m.id}
                initial={{ title: titleKnown(m) ? m.title : "", date: isoDay(m.date), speaker: m.speaker ?? "", series: m.series ?? "", location: m.location ?? "" }}
                suggestedTitle={m.suggestedTitle}
                podbeanTitle={m.podbeanTitle}
                speakers={speakerNames}
                compact
              />
            </div>
          ))}
          {waiting > untitled.length && <p className="text-sm text-muted">Showing the newest {untitled.length}.</p>}
        </section>
      )}

      {groups.length ? (
        <DateCheck key={`${order}-${page}`} groups={groups} canEdit />
      ) : (
        waiting === 0 && (
          <section className="card">
            <Empty title="All checked">Every message’s date has been confirmed or came from its title.</Empty>
          </section>
        )
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn-quiet h-11" href={href(order, page - 1)}>Previous</Link>}
            {page < pages && <Link className="btn-quiet h-11" href={href(order, page + 1)}>Next</Link>}
          </div>
        </nav>
      )}
      <p className="text-sm text-muted">Dates someone confirms are never changed by Podbean again.</p>
    </>
  );
}

// What the last Podbean check found about the messages still waiting, so it's clear what
// needs a person and what the portal is still working through.
function WhyWaiting({ report, feedEpisodes }: { report: NonNullable<PodbeanResult["report"]>; feedEpisodes: number }) {
  const rows: { n: number; label: string; detail: string; samples?: string[] }[] = [
    {
      n: report.toLookUp,
      label: "Not looked up yet",
      detail: `Podbean’s feed only lists its latest ${feedEpisodes} episodes, so older ones are read from their own Podbean pages, a batch at a time. It carries on every two hours, or use the button below. Any that stay here after a few tries have a Podbean link that no longer opens.`,
    },
    { n: report.noTitle, label: "No usable title", detail: "The Podbean title doesn’t say what the message is.", samples: report.samples.noTitle },
    { n: report.noDate, label: "No date anywhere", detail: "No date in the title or description, and no upload date.", samples: report.samples.noDate },
    { n: report.notOnPodbean, label: "No Podbean link", detail: "From the old sheet without a link, so Podbean can’t help." },
  ].filter((r) => r.n > 0);
  if (!rows.length) return null;
  return (
    <details className="rounded-xl bg-banner px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">Why Podbean couldn’t fill these in</summary>
      <p className="mt-2 text-muted">
        From the last check{report.pagesRead || report.pagesFailed ? ` (read ${report.pagesRead} episode pages${report.pagesFailed ? `, ${report.pagesFailed} couldn’t be opened` : ""})` : ""}.
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
            <span className="w-14 shrink-0 font-display text-2xl font-semibold">{r.n.toLocaleString()}</span>
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{r.label}</span>
              <span className="text-muted">{r.detail}</span>
              {!!r.samples?.length && <span className="text-muted">For example: {r.samples.map((s) => `“${s}”`).join(", ")}</span>}
            </div>
          </li>
        ))}
      </ul>
      {report.toLookUp > 0 && (
        <ActionButton action={checkPodbeanNow} pendingLabel="Checking… (up to a minute)">Carry on looking them up</ActionButton>
      )}
    </details>
  );
}
