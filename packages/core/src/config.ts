/**
 * Runtime configuration: file paths, env reads, defaults.
 * No side effects on import — call functions when needed.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

export function dataDir(): string {
  return join(homedir(), ".local", "share", "mind");
}

export function configDir(): string {
  return join(homedir(), ".config", "mind");
}

export function dbPath(): string {
  return join(dataDir(), "mind.db");
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
 * Set MIND_AI_PROVIDER to one of: openai | anthropic | google  (default: openai)
 * Set MIND_CLASSIFY_MODEL / MIND_DRAFT_MODEL to override the model names.
 *
 * API key — two options, in priority order:
 *
 *   1. File: ~/.config/mind/ai.json  (mode 600)
 *      { "apiKey": "sk-..." }
 *
 *   2. Environment variable (provider-specific):
 *        openai     →  OPENAI_API_KEY
 *        anthropic  →  ANTHROPIC_API_KEY
 *        google     →  GOOGLE_GENERATIVE_AI_API_KEY
 *
 * The file wins over the env var so the key never has to live in a shell profile.
 * If neither is set the classifier stub runs: signals are still ingested and
 * escalated, but no drafts are generated until a key is provided.
 */
export type AiProvider = "openai" | "anthropic" | "google";

export function aiProvider(): AiProvider {
  const v = process.env["MIND_AI_PROVIDER"] ?? "openai";
  if (v === "openai" || v === "anthropic" || v === "google") return v;
  throw new Error(
    `MIND_AI_PROVIDER must be openai | anthropic | google, got: ${v}`,
  );
}

export function classifyModel(): string {
  return process.env["MIND_CLASSIFY_MODEL"] ?? defaultClassifyModel(aiProvider());
}

export function draftModel(): string {
  return process.env["MIND_DRAFT_MODEL"] ?? defaultDraftModel(aiProvider());
}

function defaultClassifyModel(p: AiProvider): string {
  switch (p) {
    case "openai":    return "gpt-4o-mini";
    case "anthropic": return "claude-haiku-4-5";
    case "google":    return "gemini-2.0-flash";
  }
}

function defaultDraftModel(p: AiProvider): string {
  switch (p) {
    case "openai":    return "gpt-4o";
    case "anthropic": return "claude-sonnet-4-5";
    case "google":    return "gemini-2.0-flash";
  }
}

/**
 * Loads the API key for the configured provider.
 * Reads ~/.config/mind/ai.json first; falls back to the provider env var.
 * Returns undefined if neither is set.
 */
export function loadApiKey(): string | undefined {
  try {
    const raw = readFileSync(aiConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as { apiKey?: string };
    if (parsed.apiKey) return parsed.apiKey;
  } catch {
    // File absent or unreadable — fall through.
  }
  switch (aiProvider()) {
    case "openai":    return process.env["OPENAI_API_KEY"];
    case "anthropic": return process.env["ANTHROPIC_API_KEY"];
    case "google":    return process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  }
}

export const SERVER_PORT = 8787;
export const SERVER_HOST = "127.0.0.1";
