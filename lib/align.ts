// Works out when each sentence of a transcript is spoken, from Gemini's timeline. The
// timeline was made from the audio, while the transcript may since have been corrected, so
// the two are matched word by word. A sentence whose words were all changed gets a time
// between its neighbours.

export type Segment = { start: number; text: string };
export type Sentence = { text: string; start: number | null };
export type Paragraph = Sentence[];

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function words(s: string): string[] {
  return s.split(/\s+/).map(norm).filter(Boolean);
}

// Sentences, keeping their exact text (punctuation, brackets, quotes).
export function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]+(?:[.!?]+["”’)\]]*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph))) {
    const s = m[0].trim();
    if (!s) {
      if (re.lastIndex >= paragraph.length) break;
      continue;
    }
    // Keep titles ("Pst.", "Dr.") and verse numbers ("v. 16") with their sentence.
    const prev = out[out.length - 1];
    if (prev && (/\b(?:Mr|Mrs|Ms|Dr|Pst|Ps|Rev|Revd|Bro|Sis|St|Prof|Gen|Ex|Lev|Num|Deut|Matt|Rom|Cor|Gal|Eph|Phil|Col|Heb|Rev|vs|v|vv|ch|No)\.$/i.test(prev) || /^\d/.test(s)))
      out[out.length - 1] += ` ${s}`;
    else out.push(s);
    if (re.lastIndex >= paragraph.length) break;
  }
  return out;
}

// One timed word per word in the timeline, spread evenly across its segment.
function timedWords(timeline: Segment[]): { w: string; t: number }[] {
  const segs = [...timeline].filter((s) => Number.isFinite(s.start) && s.text).sort((a, b) => a.start - b.start);
  const out: { w: string; t: number }[] = [];
  segs.forEach((seg, i) => {
    const ws = words(seg.text);
    const next = segs[i + 1]?.start ?? seg.start + ws.length * 0.4;
    const span = Math.max(0, Math.min(next - seg.start, ws.length * 0.8 + 2));
    ws.forEach((w, k) => out.push({ w, t: seg.start + (ws.length ? (k / ws.length) * span : 0) }));
  });
  return out;
}

export function alignTranscript(text: string, timeline: Segment[] | null | undefined): Paragraph[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => splitSentences(p.replace(/\s*\n\s*/g, " ")).map((s) => ({ text: s, start: null as number | null })));
  if (!timeline?.length) return paragraphs;

  const tw = timedWords(timeline);
  const sentences = paragraphs.flat();
  let j = 0;
  const WINDOW = 80;
  for (const s of sentences) {
    const ws = words(s.text);
    for (let k = 0; k < ws.length && s.start === null; k++) {
      // Match on two words in a row (or one long word), so common words like "the" don't
      // pull the match off course.
      const limit = Math.min(tw.length, j + WINDOW);
      for (let x = j; x < limit; x++) {
        if (tw[x].w !== ws[k]) continue;
        const pair = k + 1 < ws.length && x + 1 < tw.length && tw[x + 1].w === ws[k + 1];
        if (pair || (ws[k].length >= 6 && k + 1 >= ws.length) || ws[k].length >= 8) {
          s.start = tw[x].t;
          j = x + 1;
          break;
        }
      }
    }
    // Move past this sentence's words even if its start wasn't found, so the next search
    // starts near the right place.
    if (s.start !== null) j = Math.min(tw.length, j + Math.max(0, ws.length - 2));
  }

  // Fill gaps between known times, and keep times in order.
  let prev = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s.start !== null && s.start >= prev) {
      prev = s.start;
      continue;
    }
    let n = i + 1;
    while (n < sentences.length && (sentences[n].start === null || sentences[n].start! < prev)) n++;
    const next = n < sentences.length ? sentences[n].start! : prev + (n - i) * 4;
    for (let k = i; k < n; k++) sentences[k].start = prev + ((k - i + 1) / (n - i + 1)) * (next - prev);
    prev = sentences[n - 1]?.start ?? prev;
    i = n - 1;
  }
  return paragraphs;
}

// Index of the sentence playing at `time` (seconds), across all paragraphs.
export function currentIndex(starts: number[], time: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= time + 0.15) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// Reads a timeline stored in the database, ignoring anything malformed.
export function readTimeline(value: unknown): Segment[] | null {
  if (!Array.isArray(value)) return null;
  const segs = value
    .filter((s): s is Segment => !!s && typeof (s as Segment).start === "number" && typeof (s as Segment).text === "string")
    .map((s) => ({ start: s.start, text: s.text }));
  return segs.length ? segs : null;
}

// "1:05", "01:05", "1:02:03" or a plain number of seconds.
export function parseClock(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Checks a timeline from Gemini: drops empty or impossible entries and keeps times in order.
export function cleanTimeline(raw: unknown, durationSec?: number): { start: number; text: string }[] {
  const list = (raw as { segments?: unknown })?.segments;
  if (!Array.isArray(list)) return [];
  const limit = durationSec ? durationSec + 5 : Infinity;
  const out: { start: number; text: string }[] = [];
  for (const item of list) {
    const start = parseClock((item as { start?: unknown })?.start);
    const text = String((item as { text?: unknown })?.text ?? "").trim();
    if (start === null || start < 0 || start > limit || !text) continue;
    // Times that jump backwards are model mistakes: keep the text, at the previous time.
    const prev = out[out.length - 1]?.start ?? 0;
    out.push({ start: Math.round(Math.max(start, prev) * 10) / 10, text });
  }
  return out;
}
