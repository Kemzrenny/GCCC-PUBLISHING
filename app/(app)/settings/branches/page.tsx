import { prisma } from "@/lib/prisma";
import { branchConfig } from "@/lib/branch-config";
import { branchChanges } from "@/lib/branch-apply";
import ActionButton from "@/components/ActionButton";
import { Section, Row } from "@/components/settings/Section";
import { BranchesForm, LocationRow } from "@/components/settings/BranchesForm";
import { applyBranchRules } from "@/app/actions/branches";

export const metadata = { title: "Settings · Branches" };

export default async function BranchesPage() {
  const [config, values, speakers, changes] = await Promise.all([
    branchConfig(),
    prisma.message.groupBy({ by: ["location"], _count: { _all: true }, orderBy: { _count: { location: "desc" } }, take: 60 }),
    prisma.message.groupBy({ by: ["speaker"], _count: { _all: true }, orderBy: { _count: { speaker: "desc" } }, take: 40 }),
    branchChanges(),
  ]);
  const names = config.branches.map((b) => b.name);
  const waiting = [...changes.values()].reduce((n, ids) => n + ids.length, 0);

  return (
    <>
      <Section
        title="Branches"
        description="Every message carries the branch it was preached at. Podbean rarely says, so the portal follows these rules, in this order: words in the episode’s title or description, then a speaker’s dates, then the main branch."
      >
        <Row>
          <BranchesForm initial={config} speakers={speakers.map((s) => s.speaker).filter((s): s is string => !!s)} />
        </Row>
      </Section>

      <Section title="Apply the rules" description="New messages from Podbean are tagged as they arrive. To tag the ones already in the library, apply the rules here. Messages someone has edited by hand keep their branch.">
        <Row>
          <p className="text-sm">{waiting ? `${waiting.toLocaleString()} message${waiting === 1 ? "" : "s"} would change: ${[...changes.entries()].map(([b, ids]) => `${ids.length.toLocaleString()} to ${b}`).join(", ")}.` : "Every message already matches the rules."}</p>
          {waiting > 0 && (
            <div>
              <ActionButton action={applyBranchRules} className="btn-primary" pendingLabel="Applying…">
                Apply to {waiting.toLocaleString()} message{waiting === 1 ? "" : "s"}
              </ActionButton>
            </div>
          )}
        </Row>
      </Section>

      <Section title="Places named on messages" description="What the library says now, including places brought in from the old sheet. Give each one a branch to tidy them up.">
        <Row>
          <ul>
            {values.map((v) => (
              <LocationRow key={v.location ?? ""} value={v.location ?? ""} count={v._count._all} branches={names} />
            ))}
          </ul>
        </Row>
      </Section>
    </>
  );
}
