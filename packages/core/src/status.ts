/**
 * Status file — written atomically to ~/.data/kIiYOSJe/mind/status.json.
 * Mode 600. Atomic write via tmp-then-rename.
 */

import { writeFileSync, readFileSync, renameSync } from "node:fs";
import { statusPath } from "./config.js";

export interface StatusPayload {
  startedAt: string;
  version: string;
  sendEnabled: boolean;
  paused: boolean;
  adapters: { id: string; canSend: boolean; canStream: boolean }[];
  lastSignalAt: string | null;
  signalsToday: number;
  thoughtsOpen: number;
}

/** Atomically writes the status payload as JSON to statusPath(). */
export function writeStatus(payload: StatusPayload): void {
  const dest = statusPath();
  const tmp = dest + ".tmp";
  writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  renameSync(tmp, dest);
}

/** Reads and parses the status file. Returns null on any error. */
export function readStatus(): StatusPayload | null {
  try {
    const raw = readFileSync(statusPath(), "utf8");
    return JSON.parse(raw) as StatusPayload;
  } catch {
    return null;
  }
}
