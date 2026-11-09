import "server-only";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export type SplitPart = { buffer: Buffer; durationSec: number; ext: string; mime: string };

let binary: Promise<string> | null = null;

// The traced binary may not keep its executable bit on the host, so run a copy from /tmp.
function ffmpegBinary(): Promise<string> {
  binary ??= (async () => {
    if (!ffmpegPath) throw new Error("ffmpeg is not available");
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

function run(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
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

async function cut(bin: string, dir: string, input: string, segmentSeconds: number, format: { ext: string }, reencode: boolean) {
  const args = [
    "-hide_banner", "-y", "-i", input,
    "-vn", "-map", "0:a:0",
    ...(reencode ? ["-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1"] : ["-c", "copy"]),
    "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1",
    path.join(dir, `part%03d.${format.ext}`),
  ];
  const { code } = await run(bin, args);
  const files = (await readdir(dir)).filter((f) => f.startsWith("part")).sort();
  return { ok: code === 0 && files.length > 0, files };
}

// Cuts a recording into parts of about `segmentSeconds`, so each can be transcribed quickly
// and accurately. Returns null when the audio is short enough to use as it is.
export async function splitAudio(
  input: Buffer,
  extension: string,
  segmentSeconds: number
): Promise<{ total: number; parts: SplitPart[] | null }> {
  const bin = await ffmpegBinary();
  const dir = await mkdtemp(path.join(tmpdir(), "gccc-split-"));
  try {
    const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
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
