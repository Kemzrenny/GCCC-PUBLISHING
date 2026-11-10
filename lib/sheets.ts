import "server-only";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { sheetDay } from "@/lib/dates";
import { appUrl } from "@/lib/site";
import { setSetting } from "@/lib/settings";

// The Google Sheet mirror: a read-only copy of the library, written to its own tab
// ("Portal" by default) so the old tab and its history are never touched. It uses a
// Google service account; share the sheet with that account's email as an Editor.

export const sheetConfigured = () =>
  !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID);

const tabName = () => process.env.GOOGLE_SHEET_TAB ?? "Portal";

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    { algorithm: "RS256" }
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}). Check the service account key.`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function sheetsApi(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) throw new Error("Google refused access. Share the sheet with the service account as an Editor.");
    throw new Error(`Google Sheets answered ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  QUEUED: "Queued",
  TRANSCRIBING: "Transcribing",
  AI_DRAFT: "AI draft",
  IN_REVIEW: "In review",
  APPROVED: "Done",
  FAILED: "Failed",
};

const HEADER = [
  "ID",
  "Date",
  "Title",
  "Speaker",
  "Location",
  "Series",
  "Original Message Link",
  "Transcription status",
  "Transcription link",
  "Message Summary",
  "Glory Home Manual Status",
  "Glory Home Manual Link",
  "Writer",
  "Manual Code",
  "Manual Topic",
  "Tract potential",
  "Book/booklet potential",
  "Related themes",
  "Assigned person",
  "Portal link",
];

export async function buildRows(): Promise<string[][]> {
  const messages = await prisma.message.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { manuals: true, transcript: { select: { id: true, driveUrl: true } }, assignee: { select: { name: true } } },
  });
  const base = appUrl();
  return messages.map((m) => {
    const manual = m.manuals[0];
    const portal = `${base}/messages/${m.id}`;
    const transcriptLink = m.transcript?.driveUrl ?? (m.transcript ? `${portal}#transcript` : (m.externalTranscriptUrl ?? ""));
    const assignee = m.assignee?.name ?? m.assigneeName ?? "";
    return [
      m.legacyId?.toString() ?? "",
      sheetDay(m.date),
      m.title,
      m.speaker ?? "",
      m.location ?? "",
      m.series ?? "",
      m.sourceUrl ?? "",
      STATUS_LABEL[m.status] ?? m.status,
      transcriptLink,
      m.summary ?? "",
      manual?.status ?? (m.manuals.length ? "Written" : ""),
      manual?.link ?? "",
      manual?.writer ?? "",
      manual?.code ?? "",
      manual?.title ?? "",
      m.tractPotential ? "Yes" : "",
      m.bookPotential ? "Yes" : "",
      m.themes.join(", "),
      assignee + (m.dueLabel ? ` (${m.dueLabel})` : ""),
      portal,
    ];
  });
}

export async function syncSheet(): Promise<{ rows: number }> {
  if (!sheetConfigured()) throw new Error("The Google Sheet mirror isn't set up yet.");
  const token = await accessToken();
  const tab = tabName();
  const meta = (await sheetsApi(token, "?fields=sheets.properties.title")) as { sheets: { properties: { title: string } }[] };
  if (!meta.sheets.some((s) => s.properties.title === tab)) {
    await sheetsApi(token, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] }),
    });
  }
  // Cleared before reading, so a change made while this runs marks it dirty again.
  await setSetting("sheetDirty", "0");
  let rows: string[][];
  try {
    rows = await buildRows();
    const range = encodeURIComponent(`'${tab}'`);
    await sheetsApi(token, `/values/${range}:clear`, { method: "POST", body: "{}" });
    await sheetsApi(token, `/values/${range}!A1?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [HEADER, ...rows] }),
    });
  } catch (err) {
    await setSetting("sheetDirty", "1");
    throw err;
  }
  await setSetting("sheetLastSync", new Date().toISOString());
  await setSetting("sheetLastError", "");
  return { rows: rows.length };
}
