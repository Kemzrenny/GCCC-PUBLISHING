import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PROVIDERS, PROVIDER_LABELS, providerConfigured } from "@/lib/transcribe";
import { sheetConfigured } from "@/lib/sheets";
import { feedUrl } from "@/lib/podbean";
import { PageHeading } from "@/components/ui";
import ActionButton from "@/components/ActionButton";
import { ImportForm, TranscriptionSettings, InviteForm, InviteRow, MemberRow } from "@/components/SettingsForms";
import { syncSheetNow, runQueueNow } from "@/app/actions/admin";
import { checkPodbeanNow } from "@/app/actions/messages";

export const metadata = { title: "Settings" };

function when(iso: string) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}

export default async function SettingsPage() {
  const me = await currentUser();
  if (me.role !== "ADMIN") redirect("/library");
  const [s, users, invites, queue] = await Promise.all([
    getSettings(["transcribeProvider", "batchSize", "batchOrder", "autoTranscribeNew", "manualsWritten", "sheetLastSync", "sheetLastError", "sheetDirty", "podbeanLastCheck", "podbeanLastResult"]),
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.invite.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.transcriptionJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
  ]);
  let podbean: { added?: number; checked?: number } = {};
  try {
    podbean = JSON.parse(s.podbeanLastResult || "{}");
  } catch {}

  return (
    <>
      <PageHeading eyebrow="Settings" title="Run the portal." lead="Imports, transcription, the Google Sheet mirror and who has access." />

      <section className="card flex flex-col gap-4 p-6">
        <h2 className="font-display text-2xl font-semibold">Import the Publishing sheet</h2>
        <ImportForm />
      </section>

      <section className="card flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold">Transcription</h2>
          <ActionButton action={runQueueNow}>Run the queue now{queue ? ` (${queue} waiting)` : ""}</ActionButton>
        </div>
        <TranscriptionSettings
          values={s}
          providers={PROVIDERS.map((p) => ({ key: p, label: PROVIDER_LABELS[p], ready: providerConfigured(p) }))}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-3 p-6">
          <h2 className="font-display text-xl font-semibold">Podbean</h2>
          <p className="text-sm break-all text-muted">Feed: {feedUrl()}</p>
          <p className="text-sm">
            Last checked: {when(s.podbeanLastCheck)}
            {podbean.checked !== undefined && <span className="text-muted"> · {podbean.checked} episodes in the feed, {podbean.added} new</span>}
          </p>
          <p className="text-sm text-muted">Checked automatically every two hours from 6am to 10pm.</p>
          <div><ActionButton action={checkPodbeanNow} pendingLabel="Checking…">Check now</ActionButton></div>
        </section>

        <section className="card flex flex-col gap-3 p-6">
          <h2 className="font-display text-xl font-semibold">Google Sheet mirror</h2>
          {sheetConfigured() ? (
            <>
              <p className="text-sm">
                Writes to the <strong>{process.env.GOOGLE_SHEET_TAB ?? "Portal"}</strong> tab. Last updated: {when(s.sheetLastSync)}
                {s.sheetDirty === "1" && <span className="text-muted"> · changes waiting</span>}
              </p>
              {s.sheetLastError && <p className="text-sm text-alert">Last problem: {s.sheetLastError}</p>}
              <div><ActionButton action={syncSheetNow} pendingLabel="Updating…">Update the sheet now</ActionButton></div>
            </>
          ) : (
            <p className="text-sm text-muted">
              Not set up. Add GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_SHEET_ID in Vercel, then share the sheet with the service account as an Editor.
            </p>
          )}
        </section>
      </div>

      <section className="card flex flex-col gap-5 p-6">
        <h2 className="font-display text-2xl font-semibold">Team</h2>
        <InviteForm />
        {invites.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Invited, not signed up yet</h3>
            <ul>{invites.map((i) => <InviteRow key={i.email} email={i.email} role={i.role} />)}</ul>
          </div>
        )}
        <div>
          <h3 className="mb-1 text-sm font-semibold">Members</h3>
          <ul>
            {users.map((u) => (
              <MemberRow key={u.id} id={u.id} name={u.name} email={u.email} role={u.role} disabled={!!u.disabledAt} isMe={u.id === me.id} />
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">Admins manage everything. Reviewers edit and approve transcripts and fix details. Writers and viewers can read everything.</p>
      </section>
    </>
  );
}
