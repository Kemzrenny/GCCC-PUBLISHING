import Link from "next/link";
import { redirect } from "next/navigation";
import { speakerCounts } from "@/lib/speakers";
import { groupSpeakers } from "@/lib/speaker-groups";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PROVIDERS, PROVIDER_LABELS, providerConfigured } from "@/lib/transcribe";
import { sheetConfigured } from "@/lib/sheets";
import { feedUrl } from "@/lib/podbean";
import { PageHeading } from "@/components/ui";
import ActionButton from "@/components/ActionButton";
import { ImportForm, TranscriptionSettings, InviteForm, InviteRow, MemberRow } from "@/components/SettingsForms";
import { syncSheetNow, runQueueNow, backupAllNow, disconnectGoogleDrive } from "@/app/actions/admin";
import { driveClientConfigured, redirectUri } from "@/lib/drive";
import { prisma as db } from "@/lib/prisma";
import { checkPodbeanNow, runNextBatch, queueTimingsBatch } from "@/app/actions/messages";
import { HAS_AUDIO_SOURCE, NEEDS_TIMINGS } from "@/lib/jobs";
import TemplateUpload from "@/components/glory/TemplateUpload";
import TeamsForm from "@/components/glory/TeamsForm";
import { gloryConfig } from "@/lib/glory-config";
import { currentMonth } from "@/lib/glory-data";

export const metadata = { title: "Settings" };
// "Back up all now" can run for a few minutes.
export const maxDuration = 300;

function when(iso: string) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const driveResult = (await searchParams).drive;
  const me = await currentUser();
  if (me.role !== "ADMIN") redirect("/library");
  const [s, users, invites, queue] = await Promise.all([
    getSettings(["transcribeProvider", "batchSize", "batchOrder", "batchSpeaker", "autoTranscribeNew", "manualsWritten", "sheetLastSync", "sheetLastError", "sheetDirty", "podbeanLastCheck", "podbeanLastResult", "driveRefreshToken", "driveAccount", "driveLastError", "driveRootFolderId", "gloryRootFolderId", "gloryTemplateMembers", "gloryTemplateGuide"]),
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.invite.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.transcriptionJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
  ]);
  const untranscribed = { status: "NOT_STARTED" as const, externalTranscriptUrl: null };
  const [ready, noLink, readyBySpeaker] = await Promise.all([
    db.message.count({ where: { ...untranscribed, ...HAS_AUDIO_SOURCE } }),
    db.message.count({ where: { ...untranscribed, NOT: HAS_AUDIO_SOURCE } }),
    db.message.groupBy({
      by: ["speaker"],
      where: { ...untranscribed, ...HAS_AUDIO_SOURCE, speaker: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { speaker: "desc" } },
    }),
  ]);
  const speakerReady = readyBySpeaker.map((r) => ({ name: r.speaker!, ready: r._count._all }));
  const batchSpeaker = s.batchSpeaker || null;
  const [backedUp, transcripts, untimed, speakers] = await Promise.all([
    db.transcript.count({ where: { driveUrl: { not: null } } }),
    db.transcript.count(),
    db.message.count({ where: NEEDS_TIMINGS }),
    speakerCounts(),
  ]);
  const speakerDuplicates = groupSpeakers(speakers).length;
  const glory = await gloryConfig();
  const driveOn = driveClientConfigured() && !!s.driveRefreshToken;
  const DRIVE_RESULT: Record<string, string> = {
    connected: "Google Drive is connected.",
    cancelled: "Connecting was cancelled.",
    expired: "That took too long or came from another window. Try again.",
    "missing-client": "Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel first.",
  };
  const driveMessage = typeof driveResult === "string" ? (DRIVE_RESULT[driveResult] ?? driveResult) : null;
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
        <h2 className="font-display text-2xl font-semibold">Transcription</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-field/60 p-4">
            <div className="font-display text-3xl font-semibold">{queue}</div>
            <div className="text-sm text-muted">in the queue now</div>
          </div>
          <div className="rounded-xl bg-field/60 p-4">
            <div className="font-display text-3xl font-semibold">{ready.toLocaleString()}</div>
            <div className="text-sm text-muted">ready to transcribe</div>
          </div>
          <div className="rounded-xl bg-field/60 p-4">
            <div className="font-display text-3xl font-semibold">{noLink.toLocaleString()}</div>
            <div className="text-sm text-muted">not transcribed, no Podbean link</div>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <ActionButton action={runNextBatch} className="btn-primary" pendingLabel="Queueing…">
            Queue the next {s.batchSize} messages{batchSpeaker ? ` by ${batchSpeaker}` : ""}
          </ActionButton>
          <ActionButton action={runQueueNow} pendingLabel="Starting…">Resume the queue</ActionButton>
        </div>
        <p className="text-xs text-muted">
          Queue adds the next untranscribed messages
          {batchSpeaker ? ` by ${batchSpeaker} (${(speakerReady.find((r) => r.name === batchSpeaker)?.ready ?? 0).toLocaleString()} left)` : ""} ({s.batchOrder === "oldest" ? "oldest" : "newest"} first; change below). Resume restarts work on messages already
          in the queue if it seems stuck. It doesn’t add new ones.
        </p>
        {untimed > 0 && (
          <div className="flex flex-col gap-2 rounded-xl bg-banner p-4">
            <p className="text-sm">
              <span className="font-medium">{untimed.toLocaleString()} transcript{untimed === 1 ? "" : "s"} can’t follow the audio yet.</span>{" "}
              <span className="text-muted">
                They were made before timings existed. Adding timings lets the text highlight each sentence as it’s played. New transcripts get them
                automatically.
              </span>
            </p>
            <div>
              <ActionButton action={queueTimingsBatch} pendingLabel="Queueing…">
                Add timings to the next {Math.min(Number(s.batchSize) || 10, untimed)}
              </ActionButton>
            </div>
          </div>
        )}
        <TranscriptionSettings
          values={s}
          providers={PROVIDERS.map((p) => ({ key: p, label: PROVIDER_LABELS[p], ready: providerConfigured(p) }))}
          speakers={speakerReady}
        />
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold">Speakers</h2>
          <p className="text-sm text-muted">
            {speakers.length} speaker name{speakers.length === 1 ? "" : "s"} in the library
            {speakerDuplicates > 0
              ? ` · ${speakerDuplicates} look${speakerDuplicates === 1 ? "s" : ""} like the same person spelled differently.`
              : " · no duplicates spotted."}
          </p>
        </div>
        <Link href="/settings/speakers" className={speakerDuplicates ? "btn-primary" : "btn-quiet"}>
          {speakerDuplicates ? "Review and merge" : "Manage speakers"}
        </Link>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-3 p-6">
          <h2 className="font-display text-xl font-semibold">Podbean</h2>
          <p className="text-sm break-all text-muted">Feed: {feedUrl()}</p>
          <p className="text-sm">
            Last checked: {when(s.podbeanLastCheck)}
            {podbean.checked !== undefined && <span className="text-muted"> · {podbean.checked} episodes in the feed, {podbean.added} new</span>}
          </p>
          <p className="text-sm text-muted">Checked automatically every hour.</p>
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

      <section id="drive" className="card flex scroll-mt-6 flex-col gap-3 p-6">
        <h2 className="font-display text-2xl font-semibold">Google Docs backup</h2>
        <p className="text-sm text-muted">
          Every transcript is saved as a Google Doc in a <strong className="text-ink">GCCC Publishing Transcripts</strong> folder, one subfolder per year. A Doc is made when
          the AI draft is ready and updated when someone edits or approves it. The portal can only see the folder and Docs it made.
        </p>
        {driveMessage && <p role="status" className={`text-sm ${driveResult === "connected" ? "text-accent" : "text-alert"}`}>{driveMessage}</p>}
        {!driveClientConfigured() ? (
          <p className="text-sm text-muted">
            Not set up. Create a Google OAuth client and add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel. Its authorised redirect URI must be{" "}
            <code className="rounded bg-field px-1.5 py-0.5 text-ink">{redirectUri()}</code>
          </p>
        ) : driveOn ? (
          <>
            <p className="text-sm">
              Connected to <strong>{s.driveAccount || "a Google account"}</strong> · {backedUp} of {transcripts} transcripts backed up
              {s.driveRootFolderId && (
                <>
                  {" "}·{" "}
                  <a className="link" href={`https://drive.google.com/drive/folders/${s.driveRootFolderId}`} target="_blank" rel="noreferrer">
                    Open the folder
                  </a>
                </>
              )}
            </p>
            {s.driveLastError && <p className="text-sm text-alert">Last problem: {s.driveLastError}</p>}
            <div className="flex flex-wrap gap-3">
              <ActionButton action={backupAllNow} className="btn-primary" pendingLabel="Backing up… this can take a few minutes">
                Back up all now
              </ActionButton>
              <a className="btn-quiet" href="/api/google/connect">Reconnect</a>
              <ActionButton action={disconnectGoogleDrive} confirm="Stop backing up to this Google account? Existing Docs stay in Drive.">
                Disconnect
              </ActionButton>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <a className="btn-primary" href="/api/google/connect">Connect Google Drive</a>
            <span className="text-sm text-muted">Use the Google account the Publishing team should own the Docs, ideally a church account.</span>
          </div>
        )}
      </section>

      <section id="glory-home" className="card flex scroll-mt-6 flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-semibold">Glory Home</h2>
          <p className="text-sm text-muted">
            Manuals are kept in a Glory Home folder the portal makes in {s.driveAccount || "the connected Google account"}
            {s.gloryRootFolderId ? (
              <>
                {" "}(
                <a className="link" href={`https://drive.google.com/drive/folders/${s.gloryRootFolderId}`} target="_blank" rel="noreferrer">open it</a>)
              </>
            ) : null}
            . {driveOn ? "" : "Connect Google Drive above first."}
          </p>
        </div>
        {driveOn && (
          <div className="flex flex-col gap-3">
            <h3 className="font-medium">Templates</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <TemplateUpload kind="members" label="Members Manual template" url={s.gloryTemplateMembers ? `https://docs.google.com/document/d/${s.gloryTemplateMembers}/edit` : null} />
              <TemplateUpload kind="guide" label="Teacher’s Guide template" url={s.gloryTemplateGuide ? `https://docs.google.com/document/d/${s.gloryTemplateGuide}/edit` : null} />
            </div>
            <p className="text-[13px] text-muted">
              New manuals are copies of these, with “GLORY HOME MANUAL XXX”, the date and the topic filled in. Filling those in needs the Google Docs API turned on in the same Google Cloud project as Drive:{" "}
              <a className="link" href="https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=985380904832" target="_blank" rel="noreferrer">turn it on here</a>.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-3">
          <h3 className="font-medium">Writing teams</h3>
          <TeamsForm teams={glory.teams} rotation={glory.rotation} thisMonth={currentMonth()} />
        </div>
      </section>

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
