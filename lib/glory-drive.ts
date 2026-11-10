import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { accessToken, drive, createFolder, folderUsable, DriveError } from "@/lib/drive";
import { getSetting, getSettings, setSetting } from "@/lib/settings";
import { docTitle, folderPath, longDate, manualCode } from "@/lib/glory";
import { gloryConfig } from "@/lib/glory-config";

// The portal's own Glory Home folder on Drive, in the connected account
// (gloryrealmspublishing@gmail.com). The portal creates everything in it, so the limited
// drive.file permission is enough: templates, a folder per month, each manual's two
// documents, and the folder shared with the writers.

const ROOT_NAME = "Glory Home";
const DOC_MIME = "application/vnd.google-apps.document";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type DriveFile = { id: string; webViewLink: string };

export async function gloryRoot(token: string): Promise<string> {
  const id = await getSetting("gloryRootFolderId");
  if (await folderUsable(token, id)) return id;
  const made = await createFolder(token, ROOT_NAME);
  await setSetting("gloryRootFolderId", made);
  await setSetting("gloryFolders", "{}");
  await setSetting("gloryShared", "[]");
  return made;
}

// A folder inside Glory Home ("2026 Manuals/11_November_2026"), made if missing.
export async function gloryFolder(token: string, path: string[]): Promise<string> {
  let parent = await gloryRoot(token);
  let folders: Record<string, string> = {};
  try {
    folders = JSON.parse(await getSetting("gloryFolders"));
  } catch {}
  let changed = false;
  for (let i = 0; i < path.length; i++) {
    const key = path.slice(0, i + 1).join("/");
    if (!folders[key] || !(await folderUsable(token, folders[key]))) {
      folders[key] = await createFolder(token, path[i], parent);
      changed = true;
    }
    parent = folders[key];
  }
  if (changed) await setSetting("gloryFolders", JSON.stringify(folders));
  return parent;
}

// Uploads a Word file (as a Google Doc) or a PDF into a folder.
// "original" is the file's own name, which says what kind of file it is.
export async function uploadFile(token: string, f: { name: string; original: string; mime: string; data: Buffer; parent: string }): Promise<DriveFile> {
  const convert = f.mime === DOCX_MIME || /\.docx?$/i.test(f.original);
  const pdf = /\.pdf$/i.test(f.original);
  const boundary = `gh${randomBytes(12).toString("hex")}`;
  const meta = { name: f.name.replace(/\.(docx?|pdf)$/i, ""), parents: [f.parent], ...(convert ? { mimeType: DOC_MIME } : {}) };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${convert ? DOCX_MIME : pdf ? "application/pdf" : f.mime || "application/octet-stream"}\r\n\r\n`),
    f.data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return drive<DriveFile>(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

async function copyFile(token: string, id: string, name: string, parent: string): Promise<DriveFile> {
  return drive<DriveFile>(token, `https://www.googleapis.com/drive/v3/files/${id}/copy?fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parents: [parent] }),
  });
}

// Fills the template's header ("GLORY HOME MANUAL XXX", "Date (Day, Month, Year)",
// "Topic - XXXXX"). Needs the Google Docs API turned on; without it the documents are still
// made, just with the placeholders left in.
async function fillPlaceholders(token: string, docId: string, pairs: [string, string][]): Promise<boolean> {
  try {
    await drive(token, `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: pairs.map(([find, replace]) => ({ replaceAllText: { containsText: { text: find, matchCase: false }, replaceText: replace } })),
      }),
    });
    return true;
  } catch (err) {
    console.error("Filling the manual's header failed:", err);
    return false;
  }
}

export async function uploadTemplate(kind: "members" | "guide", name: string, data: Buffer) {
  const token = await accessToken();
  const folder = await gloryFolder(token, ["Templates"]);
  const f = await uploadFile(token, { name, original: `${name}.docx`, mime: DOCX_MIME, data, parent: folder });
  await setSetting(kind === "members" ? "gloryTemplateMembers" : "gloryTemplateGuide", f.id);
  return f;
}

// Makes a manual's Members Manual and Teacher's Guide from the templates, in its month's
// folder. Documents it already has are left alone.
export async function createManualDocs(manualId: string): Promise<{ filled: boolean }> {
  const s = await getSettings(["gloryTemplateMembers", "gloryTemplateGuide"]);
  if (!s.gloryTemplateMembers || !s.gloryTemplateGuide) throw new DriveError("Upload the two Glory Home templates in Settings first.");
  const m = await prisma.manual.findUniqueOrThrow({ where: { id: manualId } });
  const token = await accessToken();
  const folder = await gloryFolder(token, folderPath(m.saturday));
  const header = (guide: boolean): [string, string][] => [
    ["GLORY HOME MANUAL XXXX", `GLORY HOME ${manualCode(m.number) ?? "MANUAL"}`],
    ["GLORY HOME MANUAL XXX", `GLORY HOME ${manualCode(m.number) ?? "MANUAL"}`],
    ["Date (Day, Month, Year)", m.saturday ? longDate(m.saturday) : "Date (Day, Month, Year)"],
    [guide ? "Topic - XXXXXX" : "Topic - XXXXX", `Topic - ${m.title?.trim() || "XXXXX"}`],
  ];
  let filled = true;
  const data: Record<string, string> = {};
  if (!m.membersDocId) {
    const f = await copyFile(token, s.gloryTemplateMembers, docTitle("members", m), folder);
    filled = (await fillPlaceholders(token, f.id, header(false))) && filled;
    Object.assign(data, { membersDocId: f.id, membersUrl: f.webViewLink });
  }
  if (!m.guideDocId) {
    const f = await copyFile(token, s.gloryTemplateGuide, docTitle("guide", m), folder);
    filled = (await fillPlaceholders(token, f.id, header(true))) && filled;
    Object.assign(data, { guideDocId: f.id, guideUrl: f.webViewLink });
  }
  if (Object.keys(data).length) await prisma.manual.update({ where: { id: m.id }, data });
  return { filled };
}

// Gives every team member with an email edit access to the whole Glory Home folder.
export async function shareWithTeam(): Promise<{ shared: string[] }> {
  const { teams } = await gloryConfig();
  const emails = [...new Set(teams.flatMap((t) => t.members.map((m) => m.email.trim().toLowerCase())).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  let done: string[] = [];
  try {
    done = JSON.parse(await getSetting("gloryShared"));
  } catch {}
  const token = await accessToken();
  const root = await gloryRoot(token);
  const shared: string[] = [];
  for (const email of emails.filter((e) => !done.includes(e))) {
    await drive(token, `https://www.googleapis.com/drive/v3/files/${root}/permissions?sendNotificationEmail=true&fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "writer", type: "user", emailAddress: email }),
    });
    shared.push(email);
  }
  if (shared.length) await setSetting("gloryShared", JSON.stringify([...done, ...shared]));
  return { shared };
}

export async function gloryRootUrl(): Promise<string | null> {
  const id = await getSetting("gloryRootFolderId");
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}
