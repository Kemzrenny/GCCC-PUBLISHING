import "server-only";
import { prisma } from "@/lib/prisma";

// Small values the team can change from Settings without a redeploy.
export const SETTING_DEFAULTS = {
  // Total Glory Home manuals written so far (the brainstorm plan's count). The library
  // shows how many of these are linked to a message.
  manualsWritten: "183",
  // How many messages "Run next batch" queues at a time.
  batchSize: "10",
  // Which way the backlog is worked through: "newest" or "oldest".
  batchOrder: "newest",
  // Which speech-to-text service new transcriptions use: "gemini", "openai" or "elevenlabs".
  transcribeProvider: "gemini",
  // "1": messages that arrive from Podbean are queued for transcription straight away.
  autoTranscribeNew: "1",
  // Set to "1" when something changed that the Google Sheet mirror hasn't caught up with.
  sheetDirty: "0",
  sheetLastSync: "",
  sheetLastError: "",
  podbeanLastCheck: "",
  podbeanLastResult: "",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key];
}

export async function getSettings<K extends SettingKey>(keys: K[]): Promise<Record<K, string>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = rows.find((r) => r.key === k)?.value ?? SETTING_DEFAULTS[k];
  return out;
}

export async function setSetting(key: SettingKey, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

// Anything that changes what the sheet should show calls this.
export async function markSheetDirty() {
  await setSetting("sheetDirty", "1").catch(() => {});
}
