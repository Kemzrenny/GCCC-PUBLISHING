import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { Section, Row } from "@/components/settings/Section";
import { InviteForm, InviteRow, MemberRow } from "@/components/SettingsForms";

export const metadata = { title: "Settings · Team" };

export default async function TeamPage() {
  const me = await currentUser();
  const [users, invites] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.invite.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <>
      <Section title="Invite someone" description="They create their account on the sign-in page with the invited email.">
        <Row>
          <InviteForm />
          <p className="text-xs text-muted">
            Admins manage everything. Reviewers edit and approve transcripts and fix details. Writers and viewers can read everything.
          </p>
        </Row>
      </Section>

      {invites.length > 0 && (
        <Section title={`Waiting to sign up (${invites.length})`}>
          <Row>
            <ul>
              {invites.map((i) => (
                <InviteRow key={i.email} email={i.email} role={i.role} />
              ))}
            </ul>
          </Row>
        </Section>
      )}

      <Section title={`Members (${users.length})`} description="Change someone’s role, or turn their account off to stop them signing in.">
        <Row>
          <ul>
            {users.map((u) => (
              <MemberRow key={u.id} id={u.id} name={u.name} email={u.email} role={u.role} disabled={!!u.disabledAt} isMe={u.id === me.id} />
            ))}
          </ul>
        </Row>
      </Section>
    </>
  );
}
