/**
 * Settings for the spoken daily summary, rendered locally by Piper.
 *
 * Piper is a separately installed program that mind runs as a child process;
 * none of its code is part of this repo (see .kiro/steering/licensing.md,
 * "Bridges"). The one network use is downloading a voice file when the chosen
 * voice is not on disk, from the public rhasspy/piper-voices repository on
 * huggingface.co. That is the only egress audio adds, it only happens when
 * `autoDownload` is on, and it is listed here so it stays visible in config.
 */

import { join } from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { configDir, dataDir, ensureDirs } from "./config.js";

/** `en_US-lessac-medium`: language_REGION-name-quality, as named in rhasspy/piper-voices. */
export const VOICE_NAME_PATTERN = /^[a-z]{2,3}_[A-Z]{2}-[a-z0-9_]+-(x_low|low|medium|high)$/;

export const SUMMARY_TONES = ["calm", "neutral", "upbeat"] as const;
export type SummaryTone = (typeof SUMMARY_TONES)[number];

export const AudioSettingsSchema = z.object({
  /** Voice (model) name. The operator types this; the file is fetched on first use. */
  voice: z
    .string()
    .regex(VOICE_NAME_PATTERN, "expected a Piper voice name such as en_US-lessac-medium"),
  /** Piper speaker id for multi-speaker voices; null for single-speaker ones. */
  speaker: z.number().int().min(0).nullable(),
  /** Speaking rate multiplier. 1 is the voice's natural pace. */
  speed: z.number().min(0.5).max(2),
  tone: z.enum(SUMMARY_TONES),
  /** The command that runs Piper, split on spaces and run without a shell. */
  piperCommand: z.string().min(1).max(200),
  /** Download a missing voice from huggingface.co (the only egress audio adds). */
  autoDownload: z.boolean(),
});
export type AudioSettings = z.infer<typeof AudioSettingsSchema>;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  voice: "en_US-lessac-medium",
  speaker: null,
  speed: 1,
  tone: "neutral",
  piperCommand: "python3 -m piper",
  autoDownload: true,
};

export function audioSettingsPath(): string {
  return join(configDir(), "audio.json");
}

/** Where downloaded voices live. */
export function voiceDir(): string {
  return join(dataDir(), "voices");
}

/** Where rendered summaries live. Plain WAV files, one per day. */
export function audioDir(): string {
  return join(dataDir(), "audio");
}

/** Current settings: the file overrides the defaults field by field, invalid fields are ignored. */
export function audioSettings(): AudioSettings {
  let stored: unknown = {};
  try {
    stored = JSON.parse(readFileSync(audioSettingsPath(), "utf8"));
  } catch {
    /* no file yet */
  }
  const merged = {
    ...DEFAULT_AUDIO_SETTINGS,
    ...(typeof stored === "object" && stored ? stored : {}),
  };
  const parsed = AudioSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_AUDIO_SETTINGS;
}

export function writeAudioSettings(settings: AudioSettings): void {
  ensureDirs();
  const path = audioSettingsPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
