import Link from "next/link";
import { currentUser, canReview } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isoDay, formatDate } from "@/lib/dates";
import { missingDetails, titleKnown } from "@/lib/needs";
import { PageHeading, Empty } from "@/components/ui";
import DetailsForm from "@/components/DetailsForm";

export const metadata = { title: "Needs details" };

export default async function NeedsDetailsPage() {
  const user = await currentUser();
  const reviewer = canReview(user.role);
  const [messages, speakers] = await Promise.all([
    prisma.message.findMany({ where: { needsDetails: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 }),
    prisma.message.groupBy({ by: ["speaker"], orderBy: { _count: { speaker: "desc" } }, take: 30 }),
  ]);
  const speakerNames = speakers.map((s) => s.speaker).filter((s): s is string => !!s);

  return (
    <>
      <PageHeading
        eyebrow="Needs details"
        title="Name it before we file it."
        lead="These Podbean episodes were uploaded without a usable title or date. Listen to the start, confirm the details, and they join the library properly."
      />
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
                  {m.podbeanTitle ? `From Podbean, around ${formatDate(m.date) || "an unknown date"}` : `From the old sheet, dated ${formatDate(m.date) || "nothing"}`}
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
