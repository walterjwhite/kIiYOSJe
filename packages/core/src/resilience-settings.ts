/**
 * How model calls are protected from a slow or failing provider.
 *
 * Every model call has a timeout, retries a transient failure with exponential
 * backoff and jitter, stops calling a provider that keeps failing (circuit
 * breaker), and shares a concurrency cap with the other calls (`performance.md`).
 * The defaults suit a local Ollama model and a free cloud tier. Change them in
 * the extension's Settings, or in `resilience.json` in the config directory.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { configDir, ensureDirs } from "./config.js";

export const ResilienceSettingsSchema = z.object({
  /** Longest one attempt may take, in seconds. A small local model on CPU can be slow. */
  timeoutSeconds: z.number().int().min(5).max(900).default(120),
  /** Extra attempts after the first for a transient failure (timeout, 429, 5xx, network). */
  retries: z.number().int().min(0).max(5).default(2),
  /** First wait before a retry, in milliseconds. It doubles, with jitter. */
  retryDelayMs: z.number().int().min(100).max(30_000).default(1_000),
  /** Consecutive failures that open the breaker. While open, calls fail at once. */
  breakerFailures: z.number().int().min(1).max(50).default(5),
  /** Seconds the breaker stays open before it lets one trial call through. */
  breakerResetSeconds: z.number().int().min(5).max(3_600).default(60),
  /** Model calls running at once. Others wait their turn. */
  maxConcurrent: z.number().int().min(1).max(8).default(2),
});
export type ResilienceSettings = z.output<typeof ResilienceSettingsSchema>;
export type ResilienceSettingsInput = z.input<typeof ResilienceSettingsSchema>;

export const DEFAULT_RESILIENCE_SETTINGS: ResilienceSettings = ResilienceSettingsSchema.parse({});

export function resilienceSettingsPath(): string {
  return join(configDir(), "resilience.json");
}

/** The stored settings, with defaults for anything missing or invalid. */
export function resilienceSettings(): ResilienceSettings {
  let stored: unknown = {};
  try {
    stored = JSON.parse(readFileSync(resilienceSettingsPath(), "utf8"));
  } catch {
    /* no file yet */
  }
  const parsed = ResilienceSettingsSchema.safeParse(
    typeof stored === "object" && stored ? stored : {},
  );
  return parsed.success ? parsed.data : DEFAULT_RESILIENCE_SETTINGS;
}

export function writeResilienceSettings(settings: ResilienceSettings): void {
  ensureDirs();
  const path = resilienceSettingsPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
