import "server-only";
import { geminiTranscribe, geminiConfigured } from "@/lib/gemini";

// Speech-to-text, swappable. Each service gets the same ~10-minute part of a sermon and
// returns plain text. Which one is used is a setting, so the team can compare them on
// real sermons and switch without a code change.

export const PROVIDERS = ["gemini", "openai", "elevenlabs"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs Scribe",
};

export function providerConfigured(p: Provider): boolean {
  if (p === "gemini") return geminiConfigured();
  if (p === "openai") return !!process.env.OPENAI_API_KEY;
  return !!process.env.ELEVENLABS_API_KEY;
}

export function isProvider(v: string): v is Provider {
  return (PROVIDERS as readonly string[]).includes(v);
}

// Names and words the services often mishear; passed as a hint where the service takes one.
const VOCABULARY =
  "Glory Centre Community Church, GCCC, Glory Realms Ministries, Papi, Pastor Olakunle Zakariya, Pastor Adesola Zakariya, Ojodu, Glory Home, Holy Spirit, Amen, Hallelujah";

export type PartInput = { buffer: Buffer; mime: string; ext: string; durationSec?: number };

async function openaiTranscribe(part: PartInput) {
  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(part.buffer)], { type: part.mime }), `part.${part.ext}`);
  form.append("model", model);
  form.append("response_format", "text");
  form.append("prompt", `A sermon. Names and terms: ${VOCABULARY}.`);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { text: (await res.text()).trim(), model };
}

async function elevenlabsTranscribe(part: PartInput) {
  const model = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v1";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(part.buffer)], { type: part.mime }), `part.${part.ext}`);
  form.append("model_id", model);
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? "").trim(), model };
}

export async function transcribePart(provider: Provider, part: PartInput): Promise<{ text: string; model: string }> {
  if (!providerConfigured(provider)) throw new Error(`${PROVIDER_LABELS[provider]} isn't set up (its API key is missing).`);
  if (provider === "openai") return openaiTranscribe(part);
  if (provider === "elevenlabs") return elevenlabsTranscribe(part);
  return geminiTranscribe(part.buffer, part.mime, part.durationSec);
}
