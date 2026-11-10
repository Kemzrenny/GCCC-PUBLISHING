import { redirect } from "next/navigation";
import { currentUser, canReview } from "@/lib/auth";
import { speakerCounts } from "@/lib/speakers";
import { groupSpeakers } from "@/lib/speaker-groups";
import { PageHeading, Empty } from "@/components/ui";
import { GroupCard, SpeakerRow } from "@/components/SpeakerTools";

export const metadata = { title: "Speakers" };

export default async function SpeakersPage() {
  const user = await currentUser();
  if (!canReview(user.role)) redirect("/library");
  const speakers = await speakerCounts();
  const groups = groupSpeakers(speakers);

  return (
    <>
      <PageHeading
        eyebrow="Speakers"
        title="One name per minister."
        lead="Merge spellings of the same person so the library’s speaker filter and the counts are right. The portal remembers each merge, so new messages from Podbean and the sheet get the right name too."
      />

      <datalist id="speaker-names">
        {speakers.map((s) => (
          <option key={s.name} value={s.name} />
        ))}
      </datalist>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold">Probably the same person</h2>
        {groups.length === 0 ? (
          <div className="card">
            <Empty title="No duplicates spotted">Use the full list below to rename or merge any others.</Empty>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">These are suggestions. Untick any name that’s a different person before merging.</p>
            <div className="grid gap-4 xl:grid-cols-2">
              {groups.map((g) => (
                <GroupCard key={g.names.map((n) => n.name).join("|")} suggested={g.suggested} names={g.names} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-6">
        <h2 className="font-display text-2xl font-semibold">All speakers ({speakers.length})</h2>
        <p className="text-sm text-muted">
          Type another speaker’s name to merge into them, or a corrected spelling to rename. Use <strong className="text-ink">Not a speaker</strong> for
          entries like the church’s name.
        </p>
        <ul>
          {speakers.map((s) => (
            <SpeakerRow key={s.name} name={s.name} count={s.count} />
          ))}
        </ul>
      </section>
    </>
  );
}
