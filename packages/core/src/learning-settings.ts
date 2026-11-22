/**
 * When the learning loop runs on its own.
 *
 * The loop reads a week of decisions and may call the configured model for an
 * insight, so it runs overnight, when the operator is least likely to be using
 * the app or the extension. The default window is 00:00 to 04:00 in the
 * server's local time zone. It also runs when the system is idle and enough new
 * decisions have arrived (idleMinutes, minNewDecisions, minGapMinutes). Change
 * these in the extension's Settings, or by editing `learning.json` in the
 * config directory.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { configDir, ensureDirs } from "./config.js";

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM, e.g. 04:00");

export const LearningSettingsSchema = z.object({
  /** Start of the nightly window, local time, 24-hour HH:MM. */
  windowStart: TimeOfDay,
  /** End of the nightly window (exclusive). May be earlier than the start to cross midnight. */
  windowEnd: TimeOfDay,
  /** Also run when the system has been quiet and enough new decisions have come in. */
  idleEnabled: z.boolean().default(true),
  /** Minutes with no activity before the system counts as idle. */
  idleMinutes: z.number().int().min(1).max(240).default(10),
  /** New decisions (sent, discarded, moved) since the last run needed to trigger an idle run. */
  minNewDecisions: z.number().int().min(1).max(1000).default(5),
  /** Least minutes between any two runs started by the idle trigger. */
  minGapMinutes: z.number().int().min(5).max(1440).default(60),
});
export type LearningSettings = z.output<typeof LearningSettingsSchema>;
export type LearningSettingsInput = z.input<typeof LearningSettingsSchema>;

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  windowStart: "00:00",
  windowEnd: "04:00",
  idleEnabled: true,
  idleMinutes: 10,
  minNewDecisions: 5,
  minGapMinutes: 60,
};

export function learningSettingsPath(): string {
  return join(configDir(), "learning.json");
}

export function learningSettings(): LearningSettings {
  let stored: unknown = {};
  try {
    stored = JSON.parse(readFileSync(learningSettingsPath(), "utf8"));
  } catch {
    /* no file yet */
  }
  const merged = {
    ...DEFAULT_LEARNING_SETTINGS,
    ...(typeof stored === "object" && stored ? stored : {}),
  };
  const parsed = LearningSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_LEARNING_SETTINGS;
}

export function writeLearningSettings(settings: LearningSettings): void {
  ensureDirs();
  const path = learningSettingsPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * True when `now` (local time) is inside the window. The end is exclusive.
 * A window whose end is before its start crosses midnight (22:00 to 02:00).
 * Equal start and end means the whole day.
 */
export function isWithinLearningWindow(
  now: Date,
  settings: Pick<LearningSettings, "windowStart" | "windowEnd"> = learningSettings(),
): boolean {
  const start = minutes(settings.windowStart);
  const end = minutes(settings.windowEnd);
  const at = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  return start < end ? at >= start && at < end : at >= start || at < end;
}
