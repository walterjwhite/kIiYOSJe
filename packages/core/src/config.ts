/**
 * Runtime configuration: file paths, env reads, defaults.
 * No side effects on import — call functions when needed.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

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

/** Global send kill switch. Default false — must be explicitly enabled. */
export function globalSendEnabled(): boolean {
  return process.env["MIND_SEND_ENABLED"] === "true";
}

export const SERVER_PORT = 8787;
export const SERVER_HOST = "127.0.0.1";
