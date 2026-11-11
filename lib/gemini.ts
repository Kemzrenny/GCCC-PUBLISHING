import "server-only";
import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { z } from "zod";
import { cleanTimeline } from "@/lib/align";

// Gemini, set up the way The Doer Life uses it: the interactions API, a light model for
// short work, a careful one where accuracy matters, and a fallback when one is busy.

export class GeminiError extends Error {
  kind: "rate_limit" | "audio_unreadable" | "invalid_output" | "other";
  constructor(kind: GeminiError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new GeminiError("other", "GEMINI_API_KEY is not set.");
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    // A hard limit per request, so one slow answer can't use up a whole queue run.
    httpOptions: { timeout: 120_000, retryOptions: { attempts: 2, initialDelay: 1, maxDelay: 2 } },
  });
  return client;
}

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

const PRIMARY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
const CAREFUL_MODEL = process.env.GEMINI_CAREFUL_MODEL ?? "gemini-3.5-flash";

type InteractionsInput = Parameters<GoogleGenAI["interactions"]["create"]>[0]["input"];

function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status;
  const m = (err instanceof Error ? err.message : "").match(/^\D*(\d{3})\b/);
  return m ? Number(m[1]) : undefined;
}

function classify(err: unknown): GeminiError {
  if (err instanceof GeminiError) return err;
  const message = err instanceof Error ? err.message : "Gemini request failed.";
  if (errorStatus(err) === 429 || /rate limit|quota/i.test(message)) return new GeminiError("rate_limit", message);
  if (/audio/i.test(message) && /unsupported|invalid|decode|corrupt|unable|cannot/i.test(message)) {
    return new GeminiError("audio_unreadable", message);
  }
  return new GeminiError("other", message);
}

async function callGemini(input: InteractionsInput, schema?: object, model = PRIMARY_MODEL): Promise<{ text: string; model: string }> {
  let current = model;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const interaction = await ai().interactions.create({
        model: current,
        input,
        response_format: schema ? { type: "text", mime_type: "application/json", schema } : undefined,
      });
      const text = interaction.output_text?.trim();
      if (!text) throw new GeminiError("invalid_output", "Gemini returned nothing.");
      return { text, model: current };
    } catch (err) {
      lastError = err;
      const status = errorStatus(err);
      const transient = status === undefined || status === 429 || status >= 500;
      if (!transient) break;
      // A busy or rate-limited model: try the other one, then wait a little between tries.
      if (current !== FALLBACK_MODEL) current = FALLBACK_MODEL;
      else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw classify(lastError);
}

export type GeminiAudio = { type: "audio"; uri: string; mime_type: string };
export type StoredAudio = { uri: string; mime: string; name: string; at: string };

// Uploads audio to Gemini's file storage, where it's kept for 48 hours. A sermon's parts are
// uploaded once and used for both the transcript and the timings.
export async function storeAudio(buffer: Buffer, mimeType: string): Promise<StoredAudio> {
  const tmpPath = path.join(tmpdir(), `${randomUUID()}.audio`);
  await writeFile(tmpPath, buffer);
  try {
    const uploaded = await ai().files.upload({ file: tmpPath, config: { mimeType } });
    const filesApi = ai().files as unknown as { get: (a: { name: string }) => Promise<{ state?: unknown }> };
    let state: unknown = uploaded.state;
    for (let i = 0; i < 20 && uploaded.name && String(state ?? "").toUpperCase() === "PROCESSING"; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      state = (await filesApi.get({ name: uploaded.name })).state;
    }
    if (!uploaded.uri) throw new GeminiError("other", "Gemini didn't store the audio.");
    return { uri: uploaded.uri, mime: uploaded.mimeType ?? mimeType, name: uploaded.name ?? "", at: new Date().toISOString() };
  } catch (err) {
    throw classify(err);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

// Files are kept 48 hours; anything older than 40 is uploaded again rather than risked.
export const storedAudioFresh = (a: StoredAudio | null | undefined): a is StoredAudio =>
  !!a?.uri && Date.now() - new Date(a.at).getTime() < 40 * 3_600_000;

export async function forgetAudio(names: string[]) {
  const filesApi = ai().files as unknown as { delete: (a: { name: string }) => Promise<unknown> };
  await Promise.all(names.filter(Boolean).map((name) => filesApi.delete({ name }).catch(() => {})));
}

async function audioInput(audio: Buffer | StoredAudio, mimeType: string): Promise<GeminiAudio> {
  const stored = Buffer.isBuffer(audio) ? await storeAudio(audio, mimeType) : audio;
  return { type: "audio", uri: stored.uri, mime_type: stored.mime };
}

export const NO_SPEECH = "[no speech]";

const TRANSCRIBE_INSTRUCTION = `Transcribe this part of a sermon recorded at Glory Centre Community Church (GCCC), Lagos, Nigeria.
- Write exactly what is said, word for word, in the language spoken. Keep Yoruba or Pidgin phrases as spoken. Do not summarize, correct the theology, or add commentary.
- Break the text into paragraphs at natural pauses or topic changes.
- Write Bible references as standard references (e.g. "John 3:16") and quote scripture as it is read aloud.
- Leave out timestamps, speaker labels and headings. If the congregation responds aloud (e.g. "Amen"), you may include it in brackets.
- If a word is unclear, write your best guess followed by [?].
- If there is no intelligible speech, respond with exactly: ${NO_SPEECH}
Respond with the transcript text only.`;

// Speech runs about 15 characters a second; far more means the model is looping.
const MAX_CHARS_PER_SECOND = 60;

export async function geminiTranscribe(source: Buffer | StoredAudio, mimeType: string, durationSec?: number) {
  const audio = await audioInput(source, mimeType);
  // Parts are about 10 minutes, where the light model is fast and clean. Anything long or of
  // unknown length goes to the careful model, which drifts less.
  const long = !durationSec || durationSec > 15 * 60;
  const { text, model } = await callGemini([{ type: "text", text: TRANSCRIBE_INSTRUCTION }, audio], undefined, long ? CAREFUL_MODEL : PRIMARY_MODEL);
  if (durationSec && text.length > durationSec * MAX_CHARS_PER_SECOND + 2000) {
    throw new GeminiError("invalid_output", "The transcript came back garbled.");
  }
  return { text: text === NO_SPEECH ? "" : text, model };
}

const analysisSchema = {
  type: "object",
  properties: {
    suggestedTitle: { type: "string", description: "A short title for this message in the preacher's own words, as it would appear on Podbean. Under 10 words." },
    summary: { type: "string", description: "4-6 sentences on what the message taught, in order, naming the main scriptures and illustrations." },
    themes: { type: "array", items: { type: "string" }, description: "3-6 short themes (one to three words each), e.g. 'Sonship', 'Prayer', 'Kingdom living'." },
    scriptures: { type: "array", items: { type: "string" }, description: "Bible references actually read or cited, in standard form (e.g. 'Romans 8:14'). Leave out guesses." },
    tractPotential: { type: "boolean", description: "True if one central truth here could stand alone as a short evangelistic or teaching tract." },
    bookPotential: { type: "boolean", description: "True if this is a substantial teaching that could be a book chapter or anchor a booklet." },
  },
  required: ["suggestedTitle", "summary", "themes", "scriptures", "tractPotential", "bookPotential"],
};

const analysisResult = z.object({
  suggestedTitle: z.string(),
  summary: z.string().min(1),
  themes: z.array(z.string()),
  scriptures: z.array(z.string()),
  tractPotential: z.boolean(),
  bookPotential: z.boolean(),
});

export type Analysis = z.infer<typeof analysisResult>;

const ANALYSIS_INSTRUCTION = `You document sermons for the Publishing team of Glory Realms Ministries (Glory Centre Community Church, Lagos).
Read the transcript and describe it faithfully: only what was actually said, no generic devotional language.
Never use em dashes or en dashes; use commas, colons or full stops.
Respond only with the JSON described by the schema.`;

// Transcripts can be long (an hour of preaching is ~50,000 characters); the model reads
// them whole, but very long ones are trimmed from the middle to stay within limits.
export async function analyseTranscript(text: string, context: { title?: string | null; speaker?: string | null }): Promise<Analysis> {
  const LIMIT = 400_000;
  const body = text.length > LIMIT ? `${text.slice(0, LIMIT / 2)}\n[...]\n${text.slice(-LIMIT / 2)}` : text;
  const header = [context.title ? `Title on file: ${context.title}` : "", context.speaker ? `Speaker: ${context.speaker}` : ""].filter(Boolean).join("\n");
  const { text: out } = await callGemini(
    [
      { type: "text", text: ANALYSIS_INSTRUCTION },
      { type: "text", text: `${header}\n\nTranscript:\n\n${body}` },
    ],
    analysisSchema,
    CAREFUL_MODEL
  );
  try {
    return analysisResult.parse(JSON.parse(out));
  } catch {
    throw new GeminiError("invalid_output", "Gemini's analysis didn't match the expected shape.");
  }
}

// ---- Timings (for following along while listening) ----

const timelineSchema = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      description: "Every sentence spoken, in order. Split very long sentences at natural pauses so no segment is longer than about 20 words.",
      items: {
        type: "object",
        properties: {
          start: { type: "string", description: "When this sentence starts, as MM:SS from the beginning of this audio clip." },
          text: { type: "string", description: "The words spoken, exactly as said." },
        },
        required: ["start", "text"],
      },
    },
  },
  required: ["segments"],
};

const TIMELINE_INSTRUCTION = `This is part of a sermon recorded at Glory Centre Community Church (GCCC), Lagos, Nigeria.
List every sentence spoken, in order, with the time it starts from the beginning of this clip.
- Times are MM:SS from the start of this clip (the clip starts at 00:00). Be precise: they will be used to highlight each sentence as it is spoken.
- Write the words exactly as said, in the language spoken. Keep Yoruba or Pidgin phrases as spoken.
- Include the congregation's responses only if they are clear (e.g. "Amen").
- If there is no intelligible speech, return an empty list.
Respond only with the JSON described by the schema.`;

export async function geminiTimeline(source: Buffer | StoredAudio, mimeType: string, durationSec?: number) {
  const audio = await audioInput(source, mimeType);
  const { text } = await callGemini([{ type: "text", text: TIMELINE_INSTRUCTION }, audio], timelineSchema, PRIMARY_MODEL);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError("invalid_output", "Gemini's timings weren't readable.");
  }
  return cleanTimeline(parsed, durationSec);
}
