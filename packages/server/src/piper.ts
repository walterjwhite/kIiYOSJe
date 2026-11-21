/**
 * Piper text-to-speech plumbing.
 *
 * Piper is a separate program the operator installs; mind runs it as a child
 * process with no shell and reads the text from stdin, so message content never
 * appears on a command line. Nothing from Piper is vendored (licensing.md,
 * "Bridges").
 *
 * The one network use is fetching a voice that is not on disk, from the public
 * rhasspy/piper-voices repository on huggingface.co. It happens only when
 * `autoDownload` is on and the voice name passes a strict pattern, so the name
 * can never become a path or a different host.
 *
 * All I/O comes in through `PiperIo`, so tests run without Piper or a network.
 */

import { join } from "node:path";
import { VOICE_NAME_PATTERN } from "@mind/core";
import type { AudioSettings, SummaryTone } from "@mind/core";

export type PiperErrorCode =
  | "piper_not_found"
  | "voice_missing"
  | "download_failed"
  | "render_failed"
  | "bad_voice_name";

export class PiperError extends Error {
  constructor(
    readonly code: PiperErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PiperError";
  }
}

export interface RunResult {
  readonly code: number | null;
  readonly stderr: string;
}

export interface PiperIo {
  exists(path: string): boolean;
  mkdirp(path: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
  /** Runs a program with no shell, writes `stdin` to it, and resolves when it exits. Rejects with code ENOENT if the program is missing. */
  run(file: string, args: readonly string[], stdin: string, timeoutMs: number): Promise<RunResult>;
  /** Downloads `url` to `dest`, failing if it exceeds `maxBytes` or `timeoutMs`. */
  download(url: string, dest: string, maxBytes: number, timeoutMs: number): Promise<void>;
}

const RENDER_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;
const MAX_VOICE_BYTES = 400 * 1024 * 1024;
const VOICE_REPO = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/** "python3 -m piper" becomes a program and its leading arguments. Never passed to a shell. */
export function parsePiperCommand(command: string): { file: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const [file, ...args] = parts;
  if (!file)
    throw new PiperError("piper_not_found", "The Piper command is empty. Set it in Settings.");
  return { file, args };
}

/** Where a voice lives in rhasspy/piper-voices: en_US-lessac-medium -> en/en_US/lessac/medium/... */
export function voiceUrls(voice: string): { onnx: string; config: string } {
  if (!VOICE_NAME_PATTERN.test(voice)) {
    throw new PiperError(
      "bad_voice_name",
      `"${voice}" is not a Piper voice name such as en_US-lessac-medium.`,
    );
  }
  const [langRegion, name, quality] = voice.split("-") as [string, string, string];
  const language = langRegion.split("_")[0]!;
  const base = `${VOICE_REPO}/${language}/${langRegion}/${name}/${quality}/${voice}`;
  return { onnx: `${base}.onnx`, config: `${base}.onnx.json` };
}

const TONE_PROSODY: Record<SummaryTone, { noiseScale: number; noiseW: number }> = {
  // Lower values make the delivery flatter and steadier, higher ones more varied.
  calm: { noiseScale: 0.5, noiseW: 0.6 },
  neutral: { noiseScale: 0.667, noiseW: 0.8 },
  upbeat: { noiseScale: 0.85, noiseW: 1.0 },
};

export function piperArgs(settings: AudioSettings, modelPath: string, outFile: string): string[] {
  const { file: _file, args } = parsePiperCommand(settings.piperCommand);
  const prosody = TONE_PROSODY[settings.tone];
  return [
    ...args,
    "-m",
    modelPath,
    "-f",
    outFile,
    // Piper's length scale is the inverse of speed: below 1 is faster.
    "--length-scale",
    (1 / settings.speed).toFixed(3),
    "--noise-scale",
    String(prosody.noiseScale),
    "--noise-w-scale",
    String(prosody.noiseW),
    ...(settings.speaker === null ? [] : ["-s", String(settings.speaker)]),
  ];
}

export function voicePaths(voice: string, voiceDir: string): { onnx: string; config: string } {
  if (!VOICE_NAME_PATTERN.test(voice)) {
    throw new PiperError(
      "bad_voice_name",
      `"${voice}" is not a Piper voice name such as en_US-lessac-medium.`,
    );
  }
  return { onnx: join(voiceDir, `${voice}.onnx`), config: join(voiceDir, `${voice}.onnx.json`) };
}

/** Makes sure the voice files exist, downloading them first when allowed. Returns the model path. */
export async function ensureVoice(
  settings: AudioSettings,
  voiceDir: string,
  io: PiperIo,
): Promise<string> {
  const paths = voicePaths(settings.voice, voiceDir);
  if (io.exists(paths.onnx) && io.exists(paths.config)) return paths.onnx;

  if (!settings.autoDownload) {
    throw new PiperError(
      "voice_missing",
      `Voice ${settings.voice} is not downloaded and automatic download is off. Turn it on in Settings or place the files in ${voiceDir}.`,
    );
  }

  const urls = voiceUrls(settings.voice);
  io.mkdirp(voiceDir);
  const partial = [`${paths.onnx}.part`, `${paths.config}.part`] as const;
  try {
    await io.download(urls.config, partial[1], MAX_VOICE_BYTES, DOWNLOAD_TIMEOUT_MS);
    await io.download(urls.onnx, partial[0], MAX_VOICE_BYTES, DOWNLOAD_TIMEOUT_MS);
    // The model goes last so a half-finished download is never mistaken for a complete voice.
    io.rename(partial[1], paths.config);
    io.rename(partial[0], paths.onnx);
  } catch (err) {
    for (const p of partial) io.remove(p);
    throw new PiperError(
      "download_failed",
      `Could not download voice ${settings.voice} from huggingface.co: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return paths.onnx;
}

/** Renders `text` to a WAV at `outFile` with the configured voice. */
export async function renderSpeech(
  text: string,
  settings: AudioSettings,
  voiceDir: string,
  outFile: string,
  io: PiperIo,
): Promise<void> {
  const model = await ensureVoice(settings, voiceDir, io);
  const { file } = parsePiperCommand(settings.piperCommand);
  const tmp = `${outFile}.part`;

  let result: RunResult;
  try {
    result = await io.run(file, piperArgs(settings, model, tmp), text, RENDER_TIMEOUT_MS);
  } catch (err) {
    io.remove(tmp);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PiperError(
        "piper_not_found",
        `Could not run "${file}". Install Piper (for example "pip install piper-tts") or set the command in Settings.`,
      );
    }
    throw new PiperError(
      "render_failed",
      `Piper did not finish: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (result.code !== 0 || !io.exists(tmp)) {
    io.remove(tmp);
    const detail = result.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
    throw new PiperError(
      "render_failed",
      `Piper exited with code ${result.code}. ${detail}`.trim(),
    );
  }
  io.rename(tmp, outFile);
}
