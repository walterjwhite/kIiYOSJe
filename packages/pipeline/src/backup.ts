/**
 * Nightly database backup.
 *
 * Uses better-sqlite3's built-in .backup() which produces a consistent
 * hot-backup without locking reads.
 *
 * Backup files: ~/.data/kIiYOSJe/mind/backups/mind-YYYY-MM-DD.db
 * Rotation: keeps the 14 most recent files, deletes the rest.
 */

import { join } from "node:path";
import { readdirSync, unlinkSync } from "node:fs";
import { getRawDb, backupDir, logger } from "@mind/core";

const KEEP_BACKUPS = 14;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startBackupJob(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  // Run once at startup (catches the case where the server was down at midnight).
  runBackup().catch((err) => logger.error({ err }, "backup: initial run failed"));
  return setInterval(
    () => runBackup().catch((err) => logger.error({ err }, "backup: scheduled run failed")),
    intervalMs,
  );
}

export async function runBackup(): Promise<void> {
  const dir = backupDir();
  const date = new Date().toISOString().slice(0, 10);
  const dest = join(dir, `mind-${date}.db`);

  try {
    const raw = getRawDb();
    await raw.backup(dest);
    logger.info({ dest }, "backup: completed");
  } catch (err) {
    logger.error({ err, dest }, "backup: failed");
    return;
  }

  rotateBackups(dir);
}

function rotateBackups(dir: string): void {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.startsWith("mind-") && f.endsWith(".db"))
      .sort(); // lexicographic = chronological for YYYY-MM-DD names
  } catch {
    return;
  }

  while (files.length > KEEP_BACKUPS) {
    const oldest = files.shift()!;
    try {
      unlinkSync(join(dir, oldest));
      logger.debug({ file: oldest }, "backup: rotated old file");
    } catch {
      // Non-fatal — file may have been deleted manually.
    }
  }
}
