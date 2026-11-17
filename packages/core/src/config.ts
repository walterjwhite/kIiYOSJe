/**
 * Runtime configuration: file paths, env reads, defaults.
 * No side effects on import — call functions when needed.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, renameSync } from "node:fs";

export function dataDir(): string {
  return join(homedir(), ".local", "share", "mind");
}

export function configDir(): string {
  return join(homedir(), ".config", "mind");
}

export function dbPath(): string {
  return process.env["MIND_DB_PATH"] ?? join(dataDir(), "mind.db");
}

export function tokenPath(): string {
  return join(configDir(), "token");
}

export function logPath(): string {
  return join(dataDir(), "mind.log");
}

export function backupDir(): string {
  return join(dataDir(), "backups");
}

export function aiConfigPath(): string {
  return join(configDir(), "ai.json");
}

export function statusPath(): string {
  return join(dataDir(), "status.json");
}

export function pausedFlagPath(): string {
  return join(configDir(), "paused");
}

/** Create data and config directories if they do not exist. */
export function ensureDirs(): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  mkdirSync(backupDir(), { recursive: true, mode: 0o700 });
}

/** Retention window in days (default 30). */
export function retentionDays(): number {
  const v = process.env["MIND_RETENTION_DAYS"];
  return v ? parseInt(v, 10) : 30;
}

/** True when the operator has engaged the kill switch (`mind pause`). */
export function isPaused(): boolean {
  return existsSync(pausedFlagPath());
}

/** Global send kill switch. Default false — must be explicitly enabled. */
export function globalSendEnabled(): boolean {
  return process.env["MIND_SEND_ENABLED"] === "true" && !isPaused();
}

/** Create the paused flag file. Sends are blocked while this file exists. */
export function pause(): void {
  ensureDirs();
  writeFileSync(pausedFlagPath(), "", { mode: 0o600 });
}

/** Remove the paused flag file. Ignores ENOENT. */
export function resume(): void {
  try {
    unlinkSync(pausedFlagPath());
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ── Model provider config ────────────────────────────────────────────────────

/**
 * Which provider to use for classification and drafting.
 *
 * Config lives at ~/.config/mind/ai.json (mode 600), read fresh on every
 * call — no server restart needed to switch providers or models. This file
 * is what the VS Code extension's "mind: Configure AI Provider" command
 * writes to, so toggling providers from the editor takes effect immediately
 * on the next signal.
 *
 *   {
 *     "provider": "ollama" | "openai" | "anthropic" | "google",
 *     "classifyModel": "qwen2.5:3b-instruct",
 *     "draftModel": "qwen2.5:3b-instruct",
 *     "baseURL": "http://localhost:11434/v1",   // only meaningful for ollama
 *     "apiKey": "sk-..."                         // only meaningful for cloud providers
 *   }
 *
 * Every field is optional and falls back, in order, to the matching
 * MIND_AI_PROVIDER / MIND_CLASSIFY_MODEL / MIND_DRAFT_MODEL / MIND_AI_BASE_URL
 * environment variable, then to a built-in default. ollama requires no API
 * key — it runs entirely on your machine against a local Ollama server, so
 * the default configuration costs nothing and sends nothing off the device.
 *
 * Cloud provider API keys resolve the same way they always have:
 *   openai     →  OPENAI_API_KEY
 *   anthropic  →  ANTHROPIC_API_KEY
 *   google     →  GOOGLE_GENERATIVE_AI_API_KEY
 */
export type AiProvider = "ollama" | "openai" | "anthropic" | "google";

export interface AiConfigFile {
  provider?: AiProvider | undefined;
  classifyModel?: string | undefined;
  draftModel?: string | undefined;
  baseURL?: string | undefined;
  apiKey?: string | undefined;
}

function readAiConfigFile(): AiConfigFile {
  try {
    const raw = readFileSync(aiConfigPath(), "utf8");
    return JSON.parse(raw) as AiConfigFile;
  } catch {
    return {};
  }
}

/** Writes the AI config file atomically (temp file + rename), mode 600. */
export function writeAiConfig(config: AiConfigFile): void {
  ensureDirs();
  const path = aiConfigPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export function aiProvider(): AiProvider {
  const fromFile = readAiConfigFile().provider;
  const v = fromFile ?? process.env["MIND_AI_PROVIDER"] ?? "ollama";
  if (v === "ollama" || v === "openai" || v === "anthropic" || v === "google") return v;
  throw new Error(
    `AI provider must be ollama | openai | anthropic | google, got: ${v}`,
  );
}

export function classifyModel(): string {
  const fromFile = readAiConfigFile().classifyModel;
  return (
    fromFile ??
    process.env["MIND_CLASSIFY_MODEL"] ??
    defaultClassifyModel(aiProvider())
  );
}

export function draftModel(): string {
  const fromFile = readAiConfigFile().draftModel;
  return (
    fromFile ??
    process.env["MIND_DRAFT_MODEL"] ??
    defaultDraftModel(aiProvider())
  );
}

/** Base URL for the ollama provider. Ignored by cloud providers. */
export function aiBaseUrl(): string {
  const fromFile = readAiConfigFile().baseURL;
  return (
    fromFile ??
    process.env["MIND_AI_BASE_URL"] ??
    "http://localhost:11434/v1"
  );
}

function defaultClassifyModel(p: AiProvider): string {
  switch (p) {
    case "ollama":    return "qwen2.5:3b-instruct";
    case "openai":    return "gpt-4o-mini";
    case "anthropic": return "claude-haiku-4-5";
    case "google":    return "gemini-2.0-flash";
  }
}

function defaultDraftModel(p: AiProvider): string {
  switch (p) {
    case "ollama":    return "qwen2.5:3b-instruct";
    case "openai":    return "gpt-4o";
    case "anthropic": return "claude-sonnet-4-5";
    case "google":    return "gemini-2.0-flash";
  }
}

/**
 * Loads the API key for the configured provider.
 * Reads ~/.config/mind/ai.json first; falls back to the provider env var.
 * ollama needs no key and always returns undefined for it — callers must
 * treat "no key" as valid for ollama, unlike the cloud providers.
 */
export function loadApiKey(): string | undefined {
  const fromFile = readAiConfigFile().apiKey;
  if (fromFile) return fromFile;

  switch (aiProvider()) {
    case "ollama":    return undefined;
    case "openai":    return process.env["OPENAI_API_KEY"];
    case "anthropic": return process.env["ANTHROPIC_API_KEY"];
    case "google":    return process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  }
}

/**
 * Whether the pipeline should attempt a real model call at all. True for
 * ollama (no key needed) and for any cloud provider with a key configured.
 */
export function aiConfigured(): boolean {
  return aiProvider() === "ollama" || loadApiKey() !== undefined;
}

// ── Notification quiet period ───────────────────────────────────────────────

/**
 * Gates when mind may proactively notify the person (e.g. "your brief is
 * ready", a future escalation alert) — separate from asking for something
 * right now, which is always an explicit, one-off act the person initiated
 * and is never held back by this window. Ingestion, matching, and drafting
 * are never gated by this; only the act of telling the person about it.
 *
 * Config lives at ~/.config/mind/notifications.json (mode 600), read fresh
 * on every call, same pattern as ai.json. Defaults to Mon–Fri 08:00–15:00
 * in the server's local time zone if no file exists.
 */
export interface QuietPeriodConfig {
  /** When false, notifications are never held back by time of day. */
  enabled: boolean;
  /** 0=Sunday .. 6=Saturday. Days notifications are allowed to go out. */
  days: number[];
  /** 0-23, local time. */
  startHour: number;
  startMinute: number;
  /** 0-23, local time. */
  endHour: number;
  endMinute: number;
}

export const DEFAULT_QUIET_PERIOD: QuietPeriodConfig = {
  enabled: true,
  days: [1, 2, 3, 4, 5], // Mon–Fri
  startHour: 8,
  startMinute: 0,
  endHour: 15,
  endMinute: 0,
};

export function notificationsConfigPath(): string {
  return join(configDir(), "notifications.json");
}

function readNotificationsConfigFile(): Partial<QuietPeriodConfig> {
  try {
    const raw = readFileSync(notificationsConfigPath(), "utf8");
    return JSON.parse(raw) as Partial<QuietPeriodConfig>;
  } catch {
    return {};
  }
}

/** Current effective quiet-period config: file overrides, defaults fill gaps. */
export function quietPeriodConfig(): QuietPeriodConfig {
  return { ...DEFAULT_QUIET_PERIOD, ...readNotificationsConfigFile() };
}

/** Writes the quiet-period config file atomically (temp file + rename), mode 600. */
export function writeQuietPeriodConfig(config: QuietPeriodConfig): void {
  ensureDirs();
  const path = notificationsConfigPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * True when `at` (default now) falls inside the configured notification
 * window. When `enabled` is false, always true — the window is off, not
 * just wide open. A notification outside this window should be queued or
 * dropped by the caller, never forced through; this function only answers
 * "is it allowed right now."
 */
export function isWithinNotificationWindow(
  at: Date = new Date(),
  config: QuietPeriodConfig = quietPeriodConfig(),
): boolean {
  if (!config.enabled) return true;

  const day = at.getDay();
  if (!config.days.includes(day)) return false;

  const minutesNow = at.getHours() * 60 + at.getMinutes();
  const startMinutes = config.startHour * 60 + config.startMinute;
  const endMinutes = config.endHour * 60 + config.endMinute;

  if (startMinutes <= endMinutes) {
    return minutesNow >= startMinutes && minutesNow < endMinutes;
  }
  // Window crosses midnight (e.g. 22:00–06:00) — not the default, but supported.
  return minutesNow >= startMinutes || minutesNow < endMinutes;
}

export const SERVER_PORT = 8787;
export const SERVER_HOST = "127.0.0.1";
