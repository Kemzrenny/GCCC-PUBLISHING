import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/site";
import { getSetting, getSettings, setSetting, markSheetDirty } from "@/lib/settings";
import { seal, open } from "@/lib/secret-box";
import { docHtml, docName, folderYear } from "@/lib/drive-doc";

// Google Docs backup of every transcript. An admin connects a Google account once from
// Settings; the portal then keeps one Doc per transcript in a "GCCC Publishing Transcripts"
// folder in that account's Drive, with a subfolder per year. It uses the drive.file
// permission, so the portal can only see the folders and Docs it created itself.

const SCOPE = "https://www.googleapis.com/auth/drive.file openid email";
const ROOT_FOLDER_NAME = "GCCC Publishing Transcripts";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";

export const driveClientConfigured = () => !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
export const redirectUri = () => `${appUrl()}/api/google/callback`;

export async function driveConnected(): Promise<boolean> {
  return driveClientConfigured() && !!(await getSetting("driveRefreshToken"));
}

export class DriveError extends Error {
  reconnect: boolean;
  constructor(message: string, reconnect = false) {
    super(message);
    this.reconnect = reconnect;
  }
}

// ---- Connecting ----

export function newState() {
  return randomBytes(24).toString("base64url");
}

export function consentUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Always ask, so Google always returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function finishConnect(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { refresh_token?: string; id_token?: string; scope?: string; error_description?: string };
  if (!res.ok) throw new DriveError(`Google didn't accept the connection: ${json.error_description ?? res.status}`);
  if (!json.refresh_token) throw new DriveError("Google didn't return a long-term key. Remove the portal from your Google account's third-party access, then connect again.");
  if (!json.scope?.includes("drive.file")) throw new DriveError("Drive access wasn't granted. Connect again and tick the Google Drive box.");
  let email = "";
  try {
    // Straight from Google's token endpoint over HTTPS, so it's only read, not verified.
    email = (JSON.parse(Buffer.from(json.id_token?.split(".")[1] ?? "", "base64url").toString()) as { email?: string }).email ?? "";
  } catch {}
  // A different account means different folders: start the folder cache afresh.
  const before = await getSetting("driveAccount");
  await setSetting("driveRefreshToken", seal(json.refresh_token));
  await setSetting("driveAccount", email);
  await setSetting("driveLastError", "");
  if (before !== email) {
    await setSetting("driveRootFolderId", "");
    await setSetting("driveYearFolders", "{}");
    await prisma.$executeRaw`UPDATE "Transcript" SET "driveFileId" = NULL, "driveUrl" = NULL, "driveSyncedAt" = NULL, "driveError" = NULL`;
  }
}

export async function disconnect() {
  await setSetting("driveRefreshToken", "");
  await setSetting("driveLastError", "");
}

// ---- Talking to Drive ----

async function accessToken(): Promise<string> {
  const sealed = await getSetting("driveRefreshToken");
  const refresh = sealed ? open(sealed) : null;
  if (!refresh) throw new DriveError("Google Drive isn't connected.", true);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    if (json.error === "invalid_grant") throw new DriveError("The Google connection has expired or was removed. Connect Google Drive again in Settings.", true);
    throw new DriveError(`Google sign-in failed (${json.error ?? res.status}).`);
  }
  return json.access_token;
}

async function drive<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text();
    const err = new DriveError(`Google Drive answered ${res.status}: ${body.slice(0, 200)}`);
    (err as DriveError & { status?: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

const statusOf = (err: unknown) => (err as { status?: number })?.status;

async function folderUsable(token: string, id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const f = await drive<{ trashed?: boolean }>(token, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`);
    return !f.trashed;
  } catch (err) {
    if (statusOf(err) === 404) return false;
    throw err;
  }
}

async function createFolder(token: string, name: string, parent?: string): Promise<string> {
  const f = await drive<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
  });
  return f.id;
}

// The year folder for a transcript, made (with the top folder) if missing. A folder that
// was deleted or trashed in Drive is simply made again.
async function yearFolder(token: string, year: string): Promise<string> {
  const s = await getSettings(["driveRootFolderId", "driveYearFolders"]);
  let years: Record<string, string> = {};
  try {
    years = JSON.parse(s.driveYearFolders);
  } catch {}
  let root = s.driveRootFolderId;
  if (!(await folderUsable(token, root))) {
    root = await createFolder(token, ROOT_FOLDER_NAME);
    years = {};
    await setSetting("driveRootFolderId", root);
  }
  if (years[year] && (await folderUsable(token, years[year]))) return years[year];
  years[year] = await createFolder(token, year, root);
  await setSetting("driveYearFolders", JSON.stringify(years));
  return years[year];
}

function multipart(metadata: object, html: string) {
  const boundary = `gccc${randomBytes(12).toString("hex")}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
  return { body, headers: { "Content-Type": `multipart/related; boundary=${boundary}` } };
}

// Creates or refreshes one transcript's Doc. Returns the Doc's link.
export async function backupTranscript(transcriptId: string, token?: string): Promise<string> {
  const t = await prisma.transcript.findUniqueOrThrow({
    where: { id: transcriptId },
    include: { message: true, reviewer: { select: { name: true } } },
  });
  const m = t.message;
  const startedAt = new Date();
  const tok = token ?? (await accessToken());
  const name = docName(m);
  const html = docHtml({
    title: m.title,
    date: m.date,
    speaker: m.speaker,
    series: m.series,
    location: m.location,
    sourceUrl: m.sourceUrl,
    portalUrl: `${appUrl()}/messages/${m.id}`,
    summary: m.summary,
    themes: m.themes,
    scriptures: m.scriptures,
    text: t.text,
    approved: m.status === "APPROVED",
    approvedAt: t.approvedAt,
    reviewer: t.reviewer?.name ?? null,
  });

  type DriveFile = { id: string; webViewLink: string; trashed?: boolean };
  let file: DriveFile | null = null;
  if (t.driveFileId) {
    try {
      const { body, headers } = multipart({ name }, html);
      file = await drive<DriveFile>(tok, `https://www.googleapis.com/upload/drive/v3/files/${t.driveFileId}?uploadType=multipart&fields=id,webViewLink,trashed`, {
        method: "PATCH",
        headers,
        body,
      });
      if (file.trashed) file = null;
    } catch (err) {
      // Deleted in Drive: make a new one below.
      if (statusOf(err) !== 404) throw err;
    }
  }
  if (!file) {
    const folder = await yearFolder(tok, folderYear(m.date));
    const { body, headers } = multipart({ name, mimeType: DOC_MIME, parents: [folder] }, html);
    file = await drive<DriveFile>(tok, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers,
      body,
    });
  }
  const saved: DriveFile = file;
  const isNew = saved.webViewLink !== t.driveUrl;
  // Written directly so "updatedAt" doesn't move: a backup isn't a change to the transcript.
  // The sync time is when this upload started, so an edit made during it is caught next time.
  await prisma.$executeRaw`
    UPDATE "Transcript" SET "driveFileId" = ${saved.id}, "driveUrl" = ${saved.webViewLink}, "driveError" = NULL, "driveSyncedAt" = ${startedAt}
    WHERE id = ${t.id}`;
  if (isNew) await markSheetDirty();
  return saved.webViewLink;
}

// Backs up transcripts that are new or changed since their last backup, a few at a time.
export async function backupPending(limit = 15): Promise<{ done: number; failed: number; remaining: number }> {
  if (!(await driveConnected())) return { done: 0, failed: 0, remaining: 0 };
  const pending = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Transcript"
    WHERE "driveSyncedAt" IS NULL OR "updatedAt" > "driveSyncedAt"
    ORDER BY "driveSyncedAt" ASC NULLS FIRST, "updatedAt" DESC
    LIMIT ${limit}`;
  let done = 0;
  let failed = 0;
  if (pending.length) {
    let token: string;
    try {
      token = await accessToken();
    } catch (err) {
      await setSetting("driveLastError", err instanceof Error ? err.message : String(err));
      throw err;
    }
    for (const { id } of pending) {
      try {
        await backupTranscript(id, token);
        done++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        await prisma.$executeRaw`UPDATE "Transcript" SET "driveError" = ${message.slice(0, 500)} WHERE id = ${id}`.catch(() => {});
        await setSetting("driveLastError", message);
        if (err instanceof DriveError && err.reconnect) break;
      }
    }
    if (!failed) await setSetting("driveLastError", "");
  }
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM "Transcript" WHERE "driveSyncedAt" IS NULL OR "updatedAt" > "driveSyncedAt"`;
  return { done, failed, remaining: Number(count) };
}

// For the moments right after a transcript changes: try now, and leave it to the scheduled
// round if Drive isn't connected or answers with an error.
export async function backupSoon(messageId: string) {
  try {
    if (!(await driveConnected())) return;
    const t = await prisma.transcript.findUnique({ where: { messageId }, select: { id: true } });
    if (t) await backupTranscript(t.id);
  } catch (err) {
    console.error("Drive backup failed:", err);
  }
}
