import Link from "next/link";
import { currentUser, canReview } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isoDay, formatDate } from "@/lib/dates";
import { missingDetails, titleKnown } from "@/lib/needs";
import { PageHeading, Empty } from "@/components/ui";
import DetailsForm from "@/components/DetailsForm";
import ActionButton from "@/components/ActionButton";
import { checkPodbeanNow } from "@/app/actions/messages";

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
            <ActionButton action={checkPodbeanNow} pendingLabel="Checking…">Fill from Podbean</ActionButton>
          </div>
        </section>
      )}
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
