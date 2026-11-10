import Link from "next/link";
import { currentUser, canReview } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isoDay, formatDate } from "@/lib/dates";
import { missingDetails, titleKnown } from "@/lib/needs";
import { PageHeading, Empty } from "@/components/ui";
import DetailsForm from "@/components/DetailsForm";
import ActionButton from "@/components/ActionButton";
import { checkPodbeanNow } from "@/app/actions/messages";
import { getSetting } from "@/lib/settings";
import type { PodbeanResult } from "@/lib/podbean";

export const metadata = { title: "Needs details" };

export default async function NeedsDetailsPage() {
  const user = await currentUser();
  const reviewer = canReview(user.role);
  const [messages, total, fromSheetNoLink, speakers] = await Promise.all([
    prisma.message.findMany({ where: { needsDetails: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 }),
    prisma.message.count({ where: { needsDetails: true } }),
    prisma.message.count({ where: { needsDetails: true, podbeanTitle: null, OR: [{ sourceUrl: null }, { NOT: { sourceUrl: { contains: "podbean.com" } } }] } }),
    prisma.message.groupBy({ by: ["speaker"], orderBy: { _count: { speaker: "desc" } }, take: 30 }),
  ]);
  let last: PodbeanResult | null = null;
  try {
    last = JSON.parse((await getSetting("podbeanLastResult")) || "null");
  } catch {}
  const report = last?.report;
  const speakerNames = speakers.map((s) => s.speaker).filter((s): s is string => !!s);

  return (
    <>
      <PageHeading
        eyebrow="Needs details"
        title="Name it before we file it."
        lead="Messages whose title or date couldn’t be worked out. The portal tries the Podbean title, then the episode description, then the day it was uploaded; whatever’s left needs a person."
      />
      {total > 0 && reviewer && (
        <section className="flex flex-col gap-3 rounded-xl bg-banner p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="font-medium">{total.toLocaleString()} waiting.</span>{" "}
            <span className="text-muted">
              Checking Podbean fills in any it can. This also happens automatically every two hours.
              {fromSheetNoLink > 0 &&
                ` ${fromSheetNoLink.toLocaleString()} came from the old sheet without a Podbean link, so Podbean can’t help with those.`}
              {total > messages.length && ` Showing the newest ${messages.length}.`}
            </span>
          </p>
          <div className="shrink-0">
            <ActionButton action={checkPodbeanNow} pendingLabel="Checking… (up to a minute)">Fill from Podbean</ActionButton>
          </div>
        </section>
      )}
      {total > 0 && report && <WhyWaiting report={report} feedEpisodes={last?.checked ?? 0} />}
      {messages.length === 0 ? (
        <section className="card">
          <Empty title="All caught up">Every message in the library has a title and date.</Empty>
        </section>
      ) : (
        messages.map((m) => (
          <section key={m.id} className="card flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Link href={`/messages/${m.id}`} className="font-display text-xl font-semibold hover:underline">{m.title}</Link>
                <span className="text-sm text-muted">
                  {m.podbeanTitle
                    ? `From Podbean, uploaded around ${formatDate(m.date) || "an unknown date"} (a catch-up upload, so that's not when it was preached)`
                    : `From the old sheet, dated ${formatDate(m.date) || "nothing"}`}
                  {missingDetails(m).length > 0 && <span className="text-alert"> · needs {missingDetails(m).join(" and ")}</span>}
                </span>
              </div>
              {m.audioUrl && <audio controls preload="none" src={m.audioUrl} className="w-full max-w-sm" />}
            </div>
            {reviewer ? (
              <DetailsForm
                messageId={m.id}
                initial={{ title: titleKnown(m) ? m.title : "", date: isoDay(m.date), speaker: m.speaker ?? "", series: m.series ?? "", location: m.location ?? "" }}
                suggestedTitle={m.suggestedTitle}
                podbeanTitle={m.podbeanTitle}
                speakers={speakerNames}
                compact
              />
            ) : (
              <p className="text-sm text-muted">A reviewer or admin can confirm these details.</p>
            )}
          </section>
        ))
      )}
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
      detail: `Podbean’s feed only lists its latest ${feedEpisodes} episodes, so older ones are read from their own Podbean pages, a batch at a time. Click Fill from Podbean again to carry on. Any that stay here after a few tries have a Podbean link that no longer opens.`,
    },
    { n: report.noTitle, label: "No usable title", detail: "The Podbean title doesn’t say what the message is.", samples: report.samples.noTitle },
    {
      n: report.catchUp,
      label: "Uploaded in a batch",
      detail: "Several episodes went up on the same day, so that day isn’t when they were preached, and the title has no date.",
      samples: report.samples.catchUp,
    },
    { n: report.noDate, label: "No date anywhere", detail: "No date in the title or description, and no upload date.", samples: report.samples.noDate },
    { n: report.notOnPodbean, label: "No Podbean link", detail: "From the old sheet without a link, so Podbean can’t help." },
  ].filter((r) => r.n > 0);
  if (!rows.length) return null;
  return (
    <section className="card flex flex-col gap-3 p-6">
      <h2 className="font-display text-xl font-semibold">Why they’re still waiting</h2>
      <p className="text-sm text-muted">
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
    </section>
  );
}
