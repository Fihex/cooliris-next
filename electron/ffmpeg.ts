// Self-contained ffmpeg layer for extended formats (mkv/avi/HEVC/AC-3/DTS) and
// embedded subtitles. Spawns the bundled ffmpeg/ffprobe (asarUnpack'd) as separate
// processes — nothing is baked into the renderer. Remove this file + its one hook in
// main.ts + the deps to drop the feature entirely.

import { app } from "electron";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import path from "node:path";

const EXE = process.platform === "win32" ? ".exe" : "";

function nodeModules(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
    : path.join(app.getAppPath(), "node_modules");
}

let _ffmpeg: string | null = null;
let _ffprobe: string | null = null;
function ffmpegBin(): string {
  if (_ffmpeg) return _ffmpeg;
  const bundled = path.join(nodeModules(), "ffmpeg-static", "ffmpeg" + EXE);
  return (_ffmpeg = existsSync(bundled) ? bundled : "ffmpeg" + EXE);
}
function ffprobeBin(): string {
  if (_ffprobe) return _ffprobe;
  const bundled = path.join(
    nodeModules(), "ffprobe-static", "bin", process.platform, process.arch, "ffprobe" + EXE
  );
  return (_ffprobe = existsSync(bundled) ? bundled : "ffprobe" + EXE);
}

/* --------------------------------- probing ---------------------------------- */

// Codecs Chromium can play directly → no transcode needed.
const VIDEO_OK = new Set(["h264", "avc1", "vp8", "vp9", "av1"]);
const AUDIO_OK = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

export interface SubStream {
  index: number;
  codec: string;
  lang?: string;
  title?: string;
  text: boolean; // convertible to WebVTT (text-based, not bitmap)
}
export interface ProbeInfo {
  durationSec: number;
  video?: { codec: string; width: number; height: number };
  audio?: { codec: string };
  subtitles: SubStream[];
  mode: "native" | "remux" | "transcode";
}

const TEXT_SUBS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);

export async function probe(abs: string, container: string): Promise<ProbeInfo | null> {
  let data: any;
  try {
    data = JSON.parse(
      await run(ffprobeBin(), [
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams", abs,
      ])
    );
  } catch {
    return null;
  }
  const streams: any[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === "audio");
  const subtitles: SubStream[] = streams
    .filter((s) => s.codec_type === "subtitle")
    .map((s) => ({
      index: s.index as number,
      codec: s.codec_name as string,
      lang: s.tags?.language,
      title: s.tags?.title,
      text: TEXT_SUBS.has(s.codec_name),
    }));

  // mp4/webm with friendly codecs play natively; otherwise remux (codecs ok, bad
  // container) or transcode (unfriendly video/audio codec).
  const vOk = !v || VIDEO_OK.has(v.codec_name);
  const aOk = !a || AUDIO_OK.has(a.codec_name);
  const nativeContainer = container === "mp4" || container === "webm" || container === "m4v";
  let mode: ProbeInfo["mode"];
  if (vOk && aOk) mode = nativeContainer ? "native" : "remux";
  else mode = "transcode";

  return {
    durationSec: parseFloat(data.format?.duration ?? "0") || 0,
    video: v ? { codec: v.codec_name, width: v.width, height: v.height } : undefined,
    audio: a ? { codec: a.codec_name } : undefined,
    subtitles,
    mode,
  };
}

/* ----------------------------- streaming playback ---------------------------- */

export interface StreamOpts {
  seek?: number; // start offset (seconds) for transcoded seeking
  transcode: boolean; // false = remux (copy), true = re-encode
  hwAccel: boolean;
}

/** Spawn ffmpeg → fragmented MP4 on stdout. Returns a web stream + a cancel(). */
export function streamMedia(abs: string, opts: StreamOpts): { body: ReadableStream; cancel: () => void } {
  const args: string[] = ["-hide_banner", "-loglevel", "error"];
  if (opts.hwAccel) args.push("-hwaccel", "auto"); // GPU-assisted decode
  if (opts.seek && opts.seek > 0.1) args.push("-ss", String(opts.seek));
  args.push("-i", abs);
  if (opts.transcode) {
    // Software H.264 encode (reliable everywhere). Full hardware encode is a follow-up.
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p");
    args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2");
  } else {
    args.push("-c", "copy");
  }
  args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");

  const p = spawn(ffmpegBin(), args);
  p.stderr.on("data", () => {}); // drain so it doesn't stall
  p.on("error", () => {});
  return {
    body: Readable.toWeb(p.stdout) as unknown as ReadableStream,
    cancel: () => {
      try {
        p.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    },
  };
}

/* --------------------------- posters & subtitles ----------------------------- */

/** A single downscaled frame (~3s in) as a JPEG buffer — wall thumbnail for files
 *  Chromium can't decode. */
export async function makePoster(abs: string): Promise<Buffer | null> {
  const frame = (seekArgs: string[]) =>
    runBuffer(ffmpegBin(), [
      "-hide_banner", "-loglevel", "error", ...seekArgs, "-i", abs,
      "-frames:v", "1", "-vf", "scale=512:-1", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
    ]);
  try {
    return await frame(["-ss", "3"]);
  } catch {
    try {
      return await frame([]); // very short clip → first frame
    } catch {
      return null;
    }
  }
}

/** Extract a text subtitle stream to WebVTT (bitmap subs fail → null). */
export async function extractSubtitleVtt(abs: string, streamIndex: number): Promise<string | null> {
  try {
    return await run(ffmpegBin(), [
      "-hide_banner", "-loglevel", "error", "-i", abs, "-map", `0:${streamIndex}`, "-f", "webvtt", "pipe:1",
    ]);
  } catch {
    return null;
  }
}

/* --------------------------------- helpers ---------------------------------- */

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))));
  });
}

function runBuffer(bin: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error(err || `exit ${code}`))
    );
  });
}
