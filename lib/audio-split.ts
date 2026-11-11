import "server-only";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import { access, chmod, constants, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, statfs, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export type SplitPart = { buffer: Buffer; durationSec: number; ext: string; mime: string };

let binary: Promise<string> | null = null;

// The traced binary may not keep its executable bit on the host; only then is a copy made in
// /tmp (it's 80 MB of the server's 512 MB of temporary space).
function ffmpegBinary(): Promise<string> {
  binary ??= (async () => {
    if (!ffmpegPath) throw new Error("ffmpeg is not available");
    try {
      await access(ffmpegPath, constants.X_OK);
      return ffmpegPath;
    } catch {}
    const target = path.join(tmpdir(), "gccc-ffmpeg");
    try {
      await stat(target);
    } catch {
      const staging = `${target}.${process.pid}.tmp`;
      await copyFile(ffmpegPath, staging);
      await chmod(staging, 0o755);
      await rename(staging, target);
    }
    return target;
  })().catch((err) => {
    binary = null;
    throw err;
  });
  return binary;
}

function run(bin: string, args: string[], stdin?: Buffer): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"] });
    if (stdin && child.stdin) {
      // ffmpeg may stop reading early (bad file); that's reported by its exit code instead.
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    }
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      // Only the tail matters (errors and the duration line); keep memory small.
      stderr = (stderr + d.toString()).slice(-20_000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

async function durationOf(bin: string, file: string): Promise<number> {
  const { stderr } = await run(bin, ["-hide_banner", "-i", file]);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) : 0;
}

// What each kind of input is cut into. AAC/M4A becomes raw AAC, which Gemini reads reliably.
const COPY_FORMATS: Record<string, { ext: string; mime: string }> = {
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  mpeg: { ext: "mp3", mime: "audio/mpeg" },
  mpga: { ext: "mp3", mime: "audio/mpeg" },
  wav: { ext: "wav", mime: "audio/wav" },
  webm: { ext: "webm", mime: "audio/webm" },
  ogg: { ext: "ogg", mime: "audio/ogg" },
  oga: { ext: "ogg", mime: "audio/ogg" },
  opus: { ext: "ogg", mime: "audio/ogg" },
  flac: { ext: "flac", mime: "audio/flac" },
  m4a: { ext: "aac", mime: "audio/aac" },
  mp4: { ext: "aac", mime: "audio/aac" },
  aac: { ext: "aac", mime: "audio/aac" },
  "3gp": { ext: "aac", mime: "audio/aac" },
};
const REENCODE = { ext: "mp3", mime: "audio/mpeg" };
const GEMINI_NATIVE = new Set(["mp3", "mpeg", "mpga", "wav", "webm", "ogg", "oga", "opus", "flac", "aac"]);

async function cut(bin: string, dir: string, input: string | Buffer, segmentSeconds: number, format: { ext: string }, reencode: boolean) {
  const piped = typeof input !== "string";
  const args = [
    "-hide_banner", "-y", ...(piped ? ["-f", "mp3", "-i", "pipe:0"] : ["-i", input]),
    "-vn", "-map", "0:a:0",
    ...(reencode ? ["-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1"] : ["-c", "copy"]),
    "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1",
    path.join(dir, `part%03d.${format.ext}`),
  ];
  const { code, stderr } = await run(bin, args, piped ? input : undefined);
  if (/No space left on device/i.test(stderr)) throw new Error(NO_SPACE);
  const files = (await readdir(dir)).filter((f) => f.startsWith("part")).sort();
  return { ok: code === 0 && files.length > 0, files };
}

const NO_SPACE = "The server ran out of temporary space while splitting the audio. It will try again.";
const MP3 = new Set(["mp3", "mpeg", "mpga"]);

// One split at a time per server: two long recordings at once can fill the temporary space.
let queue: Promise<unknown> = Promise.resolve();

// A run that was cut off (a timed-out step) never reaches its clean-up, so whatever split
// folders are left when a new split starts are leftovers.
async function clearLeftovers() {
  const dir = tmpdir();
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (name.startsWith("gccc-split-")) await rm(path.join(dir, name), { recursive: true, force: true }).catch(() => {});
  }
}

async function freeBytes(): Promise<number> {
  try {
    const s = await statfs(tmpdir());
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

// Cuts a recording into parts of about `segmentSeconds`, so each can be transcribed quickly
// and accurately. Returns null when the audio is short enough to use as it is.
export function splitAudio(input: Buffer, extension: string, segmentSeconds: number): Promise<{ total: number; parts: SplitPart[] | null }> {
  const next = queue.then(() => splitOne(input, extension, segmentSeconds));
  queue = next.catch(() => {});
  return next;
}

async function splitOne(input: Buffer, extension: string, segmentSeconds: number): Promise<{ total: number; parts: SplitPart[] | null }> {
  const bin = await ffmpegBinary();
  await clearLeftovers();
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  // MP3s are streamed into ffmpeg, so only the parts touch the disk; other formats need the
  // whole file on disk as well.
  const needed = input.length * (MP3.has(ext) ? 1.1 : 2.2) + 20 * 1024 * 1024;
  const free = await freeBytes();
  if (free < needed) {
    throw new Error(`The server doesn't have enough temporary space for this recording (needs ${Math.round(needed / 1048576)} MB, has ${Math.round(free / 1048576)} MB). It will try again.`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "gccc-split-"));
  try {
    if (MP3.has(ext)) {
      const streamed = await splitMp3(bin, dir, input, segmentSeconds);
      if (streamed) return streamed;
    }
    const inputFile = path.join(dir, `input.${ext}`);
    await writeFile(inputFile, input);
    const total = await durationOf(bin, inputFile);
    // Short enough to use as it is — unless it's a format Gemini doesn't read directly (m4a).
    if (total > 0 && total <= segmentSeconds * 1.3 && GEMINI_NATIVE.has(ext)) return { total, parts: null };

    const outDir = path.join(dir, "out");
    await mkdir(outDir);

    let format = COPY_FORMATS[ext] ?? REENCODE;
    let result = COPY_FORMATS[ext] ? await cut(bin, outDir, inputFile, segmentSeconds, format, false) : { ok: false, files: [] as string[] };
    if (!result.ok) {
      // The container or codec can't be cut as-is: re-encode to a small mono mp3 instead.
      await rm(outDir, { recursive: true, force: true });
      await mkdir(outDir);
      format = REENCODE;
      result = await cut(bin, outDir, inputFile, segmentSeconds, format, true);
      if (!result.ok) throw new Error("ffmpeg could not split this audio");
    }

    // Raw AAC files don't store their length, so probing them is only a guess. The cut points
    // are exact, though: every part but the last is one segment long.
    const parts: SplitPart[] = [];
    for (let i = 0; i < result.files.length; i++) {
      const full = path.join(outDir, result.files[i]);
      const isLast = i === result.files.length - 1;
      const durationSec =
        total > 0
          ? isLast
            ? Math.max(1, total - segmentSeconds * i)
            : segmentSeconds
          : await durationOf(bin, full);
      parts.push({ buffer: await readFile(full), durationSec, ext: format.ext, mime: format.mime });
    }
    return { total, parts };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// MP3: cut straight from memory. Returns null if ffmpeg can't, so the caller falls back to
// the file-based way.
async function splitMp3(bin: string, dir: string, input: Buffer, segmentSeconds: number): Promise<{ total: number; parts: SplitPart[] | null } | null> {
  const outDir = path.join(dir, "out");
  await mkdir(outDir);
  const result = await cut(bin, outDir, input, segmentSeconds, COPY_FORMATS.mp3, false);
  if (!result.ok) {
    await rm(outDir, { recursive: true, force: true });
    return null;
  }
  const durations: number[] = [];
  for (const f of result.files) durations.push(await durationOf(bin, path.join(outDir, f)));
  const total = durations.reduce((a, b) => a + b, 0);
  // Short enough to send as it is.
  if (result.files.length === 1 && total <= segmentSeconds * 1.3) return { total, parts: null };
  const parts: SplitPart[] = [];
  for (let i = 0; i < result.files.length; i++) {
    const full = path.join(outDir, result.files[i]);
    parts.push({ buffer: await readFile(full), durationSec: Math.max(1, durations[i]), ext: "mp3", mime: "audio/mpeg" });
    // Free each part's space as soon as it's in memory.
    await rm(full, { force: true });
  }
  return { total, parts };
}

// One part of a recording (from `start`, `durationSec` long), cut again from the full audio:
// used when a stored part is no longer available.
export function extractWindow(input: Buffer, extension: string, start: number, durationSec: number): Promise<SplitPart> {
  const next = queue.then(() => extractOne(input, extension, start, durationSec));
  queue = next.catch(() => {});
  return next;
}

async function extractOne(input: Buffer, extension: string, start: number, durationSec: number): Promise<SplitPart> {
  const bin = await ffmpegBinary();
  await clearLeftovers();
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const dir = await mkdtemp(path.join(tmpdir(), "gccc-split-"));
  try {
    const window = ["-ss", String(start), "-t", String(durationSec)];
    if (MP3.has(ext)) {
      const out = path.join(dir, "part.mp3");
      const { code } = await run(bin, ["-hide_banner", "-y", "-f", "mp3", "-i", "pipe:0", ...window, "-vn", "-c", "copy", out], input);
      if (code === 0) return { buffer: await readFile(out), durationSec, ext: "mp3", mime: "audio/mpeg" };
    }
    const inputFile = path.join(dir, `input.${ext}`);
    await writeFile(inputFile, input);
    const copy = COPY_FORMATS[ext];
    if (copy) {
      const out = path.join(dir, `part.${copy.ext}`);
      const { code } = await run(bin, ["-hide_banner", "-y", ...window, "-i", inputFile, "-vn", "-map", "0:a:0", "-c", "copy", out]);
      if (code === 0) return { buffer: await readFile(out), durationSec, ext: copy.ext, mime: copy.mime };
    }
    const out = path.join(dir, "part.mp3");
    const { code } = await run(bin, ["-hide_banner", "-y", ...window, "-i", inputFile, "-vn", "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1", out]);
    if (code !== 0) throw new Error("ffmpeg could not cut this part of the audio");
    return { buffer: await readFile(out), durationSec, ext: REENCODE.ext, mime: REENCODE.mime };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
