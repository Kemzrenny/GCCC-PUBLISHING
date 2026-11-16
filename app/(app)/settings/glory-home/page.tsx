import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { driveClientConfigured } from "@/lib/drive";
import { gloryConfig } from "@/lib/glory-config";
import { currentMonth } from "@/lib/glory-data";
import { Chip } from "@/components/ui";
import { Section, Row } from "@/components/settings/Section";
import TemplateUpload from "@/components/glory/TemplateUpload";
import TeamsForm from "@/components/glory/TeamsForm";
import { ManualsWrittenForm, GlorySpeakerForm } from "@/components/SettingsForms";
import SheetUpload from "@/components/glory/SheetUpload";
import FolderImport from "@/components/glory/FolderImport";
import { gloryRootUrl } from "@/lib/glory-drive";
import { formatDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Settings · Glory Home" };

export default async function GlorySettingsPage() {
  const [s, glory, speakers] = await Promise.all([
    getSettings(["driveRefreshToken", "driveAccount", "gloryRootFolderId", "gloryTemplateMembers", "gloryTemplateGuide", "manualsWritten", "glorySpeaker", "gloryLastImport"]),
    gloryConfig(),
    prisma.message.groupBy({ by: ["speaker"], _count: { _all: true }, orderBy: { _count: { speaker: "desc" } }, take: 40 }),
  ]);
  const driveOn = driveClientConfigured() && !!s.driveRefreshToken;
  const templates = [s.gloryTemplateMembers, s.gloryTemplateGuide].filter(Boolean).length;
  const root = driveOn ? await gloryRootUrl() : null;
  let last: { at?: string; sheet?: { manuals: number; linedUp: number } } = {};
  try {
    last = JSON.parse(s.gloryLastImport || "{}");
  } catch {}

  return (
    <>
      <Section
        title="Documents"
        description="New manuals start as copies of these templates, with “GLORY HOME MANUAL XXX”, the date and the topic filled in."
        status={<Chip tone={templates === 2 ? "green" : "red"}>{templates === 2 ? "Templates ready" : `${templates} of 2 templates`}</Chip>}
      >
        <Row title="Folder" hint="Manuals are saved in a Glory Home folder in the connected Google account.">
          {driveOn ? (
            <p className="text-sm">
              In <strong>{s.driveAccount || "the connected account"}</strong>
              {s.gloryRootFolderId && (
                <>
                  {" "}·{" "}
                  <a className="link" href={`https://drive.google.com/drive/folders/${s.gloryRootFolderId}`} target="_blank" rel="noreferrer">
                    Open the folder
                  </a>
                </>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted">
              Connect Google Drive under{" "}
              <Link className="link" href="/settings/connections#drive">
                Connections
              </Link>{" "}
              first.
            </p>
          )}
        </Row>
        {driveOn && (
          <Row
            title="Templates"
            hint={
              <>
                Filling them in needs the Google Docs API turned on in the same Google Cloud project as Drive:{" "}
                <a className="link" href="https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=985380904832" target="_blank" rel="noreferrer">
                  turn it on here
                </a>
                .
              </>
            }
          >
            <div className="grid gap-3 xl:grid-cols-2">
              <TemplateUpload kind="members" label="Members Manual" url={s.gloryTemplateMembers ? `https://docs.google.com/document/d/${s.gloryTemplateMembers}/edit` : null} />
              <TemplateUpload kind="guide" label="Teacher’s Guide" url={s.gloryTemplateGuide ? `https://docs.google.com/document/d/${s.gloryTemplateGuide}/edit` : null} />
            </div>
          </Row>
        )}
        <Row title="Count" hint="The total shown in the library, including manuals from before the portal.">
          <ManualsWrittenForm value={s.manualsWritten} />
        </Row>
      </Section>

      <Section title="Messages" description="“Line up the next messages” goes through this speaker’s messages in the order they were preached, after the last one used for a manual.">
        <Row title="Written from">
          <GlorySpeakerForm value={s.glorySpeaker} speakers={speakers.map((x) => x.speaker).filter((x): x is string => !!x)} />
        </Row>
      </Section>

      <Section
        id="import"
        title="Bring in past manuals"
        description="The manuals written before the portal. Both can be run again: they update what’s there instead of adding copies. Every message used for a manual then shows its manual numbers, here and in the Google Sheet mirror."
      >
        {!driveOn ? (
          <Row>
            <p className="text-sm text-muted">
              Connect Google Drive under{" "}
              <Link className="link" href="/settings/connections#drive">
                Connections
              </Link>{" "}
              first: the Glory Home folder is made in that account.
            </p>
          </Row>
        ) : (
          <>
            <Row title="1 · The schedule" hint="Upload the Glory Home schedule workbook. Its MASTER SHEET gives manual numbers, topics, writers and Saturdays, each matched to its message.">
              <SheetUpload />
              {last.sheet && (
                <span className="text-xs text-muted">
                  Last read {formatDate(last.at)}: {last.sheet.manuals} manuals, {last.sheet.linedUp} lined up.
                </span>
              )}
            </Row>
            <Row
              title="2 · The folder"
              hint={
                <>
                  Choose the Glory Home folder from your computer. Each Members Manual and Teacher’s Guide becomes a Google Doc in the{" "}
                  {root ? (
                    <a href={root} target="_blank" rel="noreferrer" className="link">
                      Glory Home folder
                    </a>
                  ) : (
                    "Glory Home folder"
                  )}
                  , one folder per month.
                </>
              }
            >
              <FolderImport />
            </Row>
          </>
        )}
      </Section>

      <Section title="Writing teams" description="Who writes, and which team has which month. Team members get access to the Glory Home folder.">
        <Row>
          <TeamsForm teams={glory.teams} rotation={glory.rotation} thisMonth={currentMonth()} />
        </Row>
      </Section>
    </>
  );
}
