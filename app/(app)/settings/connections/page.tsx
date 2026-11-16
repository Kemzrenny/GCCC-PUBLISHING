import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { sheetConfigured } from "@/lib/sheets";
import { feedUrl } from "@/lib/podbean";
import { driveClientConfigured, redirectUri } from "@/lib/drive";
import ActionButton from "@/components/ActionButton";
import { Chip } from "@/components/ui";
import { Section, Row, when } from "@/components/settings/Section";
import { syncSheetNow, backupAllNow, disconnectGoogleDrive } from "@/app/actions/admin";
import { checkPodbeanNow } from "@/app/actions/messages";

export const metadata = { title: "Settings · Connections" };

const DRIVE_RESULT: Record<string, string> = {
  connected: "Google Drive is connected.",
  cancelled: "Connecting was cancelled.",
  expired: "That took too long or came from another window. Try again.",
  "missing-client": "Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel first.",
};

export default async function ConnectionsPage({ searchParams }: PageProps<"/settings/connections">) {
  const driveResult = (await searchParams).drive;
  const [s, backedUp, transcripts] = await Promise.all([
    getSettings(["sheetLastSync", "sheetLastError", "sheetDirty", "podbeanLastCheck", "podbeanLastResult", "driveRefreshToken", "driveAccount", "driveLastError", "driveRootFolderId"]),
    prisma.transcript.count({ where: { driveUrl: { not: null } } }),
    prisma.transcript.count(),
  ]);
  const driveOn = driveClientConfigured() && !!s.driveRefreshToken;
  const driveMessage = typeof driveResult === "string" ? (DRIVE_RESULT[driveResult] ?? driveResult) : null;
  let podbean: { added?: number; checked?: number } = {};
  try {
    podbean = JSON.parse(s.podbeanLastResult || "{}");
  } catch {}
  const sheetOn = sheetConfigured();

  return (
    <>
      <Section
        title="Podbean"
        description="Where the messages come from. New episodes are added to the library, and transcribed if that’s turned on under Transcription."
        status={<Chip tone="green">Checked every hour</Chip>}
      >
        <Row title="Feed">
          <p className="text-sm break-all text-muted">{feedUrl()}</p>
        </Row>
        <Row title="Last checked">
          <p className="text-sm">
            {when(s.podbeanLastCheck)}
            {podbean.checked !== undefined && (
              <span className="text-muted">
                {" "}· {podbean.checked} episodes in the feed, {podbean.added} new
              </span>
            )}
          </p>
          <div>
            <ActionButton action={checkPodbeanNow} pendingLabel="Checking…">
              Check now
            </ActionButton>
          </div>
        </Row>
      </Section>

      <Section
        id="drive"
        title="Google Docs backup"
        description={
          <>
            Every transcript is saved as a Google Doc in a <strong className="text-ink">GCCC Publishing Transcripts</strong> folder, one subfolder per year. The
            same account holds the Glory Home folder. The portal can only see the folders and Docs it made.
          </>
        }
        status={driveOn ? <Chip tone={s.driveLastError ? "red" : "green"}>{s.driveLastError ? "Problem" : "Connected"}</Chip> : <Chip tone="red">Not connected</Chip>}
      >
        {driveMessage && (
          <Row>
            <p role="status" className={`text-sm ${driveResult === "connected" ? "text-accent" : "text-alert"}`}>
              {driveMessage}
            </p>
          </Row>
        )}
        {!driveClientConfigured() ? (
          <Row title="Set up first">
            <p className="text-sm text-muted">
              Create a Google OAuth client and add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel. Its authorised redirect URI must be{" "}
              <code className="rounded bg-field px-1.5 py-0.5 text-ink">{redirectUri()}</code>
            </p>
          </Row>
        ) : driveOn ? (
          <>
            <Row title="Account">
              <p className="text-sm">
                <strong>{s.driveAccount || "A Google account"}</strong>
                {s.driveRootFolderId && (
                  <>
                    {" "}·{" "}
                    <a className="link" href={`https://drive.google.com/drive/folders/${s.driveRootFolderId}`} target="_blank" rel="noreferrer">
                      Open the transcripts folder
                    </a>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-3">
                <a className="btn-quiet" href="/api/google/connect">
                  Reconnect
                </a>
                <ActionButton action={disconnectGoogleDrive} confirm="Stop backing up to this Google account? Existing Docs stay in Drive.">
                  Disconnect
                </ActionButton>
              </div>
            </Row>
            <Row title="Backed up" hint="Docs are made when the AI draft is ready and updated after edits and approval.">
              <p className="text-sm">
                {backedUp.toLocaleString()} of {transcripts.toLocaleString()} transcripts
              </p>
              {s.driveLastError && <p className="text-sm text-alert">Last problem: {s.driveLastError}</p>}
              <div>
                <ActionButton action={backupAllNow} className="btn-primary" pendingLabel="Backing up… this can take a few minutes">
                  Back up all now
                </ActionButton>
              </div>
            </Row>
          </>
        ) : (
          <Row title="Connect">
            <p className="text-sm text-muted">Use the Google account the Publishing team should own the Docs, ideally a church account.</p>
            <div>
              <a className="btn-primary" href="/api/google/connect">
                Connect Google Drive
              </a>
            </div>
          </Row>
        )}
      </Section>

      <Section
        title="Google Sheet mirror"
        description="A read-only copy of the library, written to a tab of the Publishing sheet for anyone who prefers the sheet."
        status={sheetOn ? <Chip tone={s.sheetLastError ? "red" : "green"}>{s.sheetLastError ? "Problem" : "Connected"}</Chip> : <Chip tone="grey">Not set up</Chip>}
      >
        {sheetOn ? (
          <Row title="Last updated" hint={`Writes to the “${process.env.GOOGLE_SHEET_TAB ?? "Portal"}” tab.`}>
            <p className="text-sm">
              {when(s.sheetLastSync)}
              {s.sheetDirty === "1" && <span className="text-muted"> · changes waiting</span>}
            </p>
            {s.sheetLastError && <p className="text-sm text-alert">Last problem: {s.sheetLastError}</p>}
            <div>
              <ActionButton action={syncSheetNow} pendingLabel="Updating…">
                Update the sheet now
              </ActionButton>
            </div>
          </Row>
        ) : (
          <Row title="Set up first">
            <p className="text-sm text-muted">
              Add GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_SHEET_ID in Vercel, then share the sheet with the service account as an Editor.
            </p>
          </Row>
        )}
      </Section>
    </>
  );
}
