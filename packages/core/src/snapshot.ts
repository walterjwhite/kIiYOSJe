/**
 * Named development snapshots: archive the database before a risky change and
 * put it back when the test is done. The nightly backups keep their own
 * rotation (backup.ts); these stay until deleted, under
 * ~/.data/kIiYOSJe/mind/snapshots.
 */

import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  SERVER_HOST,
  SERVER_PORT,
  dbPath,
  snapshotDir,
} from "./config.js";

export type Snapshot = {
  label: string;
  path: string;
  bytes: number;
  at: string;
};

/** Archives `source` under `label`, or a UTC timestamp by default. */
export async function snapshot(
  label?: string,
  source = dbPath(),
  dir = snapshotDir(),
): Promise<string> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${safeLabel(label ?? timestamp())}.db`);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(path);
  } finally {
    db.close();
  }
  return path;
}

/** Snapshot files, newest first. A missing directory simply reads as none. */
export function listSnapshots(dir = snapshotDir()): Snapshot[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".db"));
  } catch {
    return [];
  }
  return names
    .map((name) => describe(dir, name))
    .sort((left, right) => right.at.localeCompare(left.at));
}

/**
 * Copies a snapshot over the live database, keeping the displaced file as
 * `<db>.replaced-<stamp>` so the restore itself can be undone.
 */
export async function restore(
  label: string,
  target = dbPath(),
  dir = snapshotDir(),
  assertStopped: () => Promise<void> = assertServerStopped,
): Promise<{ restored: string; archived: string | null }> {
  await assertStopped();
  const source = label.endsWith(".db")
    ? label
    : join(dir, `${safeLabel(label)}.db`);
  if (!existsSync(source)) {
    throw new Error(`no snapshot named ${label} (see mind snapshots)`);
  }
  const archived = displace(target);
  copyFileSync(source, target);
  return { restored: source, archived };
}

function describe(dir: string, name: string): Snapshot {
  const path = join(dir, name);
  const stats = statSync(path);
  return {
    label: name.replace(/\.db$/, ""),
    path,
    bytes: stats.size,
    at: stats.mtime.toISOString(),
  };
}

/** Moves the current database and its WAL sidecars out of the way. */
function displace(target: string): string | null {
  if (!existsSync(target)) return null;
  const archived = `${target}.replaced-${timestamp()}`;
  renameSync(target, archived);
  for (const sidecar of ["-wal", "-shm"]) {
    rmSync(`${target}${sidecar}`, { force: true });
  }
  return archived;
}

/**
 * A running server holds the file open and would rewrite it underneath the
 * restore, so refuse while its health endpoint answers.
 */
async function assertServerStopped(): Promise<void> {
  const url = `http://${SERVER_HOST}:${SERVER_PORT}/health`;
  try {
    await fetch(url, { signal: AbortSignal.timeout(750) });
  } catch {
    return;
  }
  throw new Error(`a mind server is answering at ${url} — stop it first`);
}

/** Filesystem-safe label: "Before Refactor" -> "before-refactor". */
export function safeLabel(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.length > 0 ? cleaned : timestamp();
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}
