/**
 * Automatic linking of new signals to Goals (active Thoughts).
 *
 * On by default. A link is only made when the model's confidence is at or
 * above `threshold`; below it the signal stays unlinked for the operator to
 * place by hand. Every automatic link is recorded as a `signal.linked` event
 * with `auto: true` and can be undone from the Queue.
 */

import { join } from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { configDir, ensureDirs } from "./config.js";

export const AutolinkSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Minimum model confidence, 0 to 1, for an automatic link. */
  threshold: z.number().min(0.5).max(1),
});
export type AutolinkSettings = z.infer<typeof AutolinkSettingsSchema>;

export const DEFAULT_AUTOLINK_SETTINGS: AutolinkSettings = { enabled: true, threshold: 0.8 };

export function autolinkSettingsPath(): string {
  return join(configDir(), "autolink.json");
}

export function autolinkSettings(): AutolinkSettings {
  let stored: unknown = {};
  try {
    stored = JSON.parse(readFileSync(autolinkSettingsPath(), "utf8"));
  } catch {
    /* no file yet */
  }
  const merged = { ...DEFAULT_AUTOLINK_SETTINGS, ...(typeof stored === "object" && stored ? stored : {}) };
  const parsed = AutolinkSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_AUTOLINK_SETTINGS;
}

export function writeAutolinkSettings(settings: AutolinkSettings): void {
  ensureDirs();
  const path = autolinkSettingsPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
