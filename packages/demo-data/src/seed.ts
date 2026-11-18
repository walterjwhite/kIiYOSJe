/**
 * Demo database lifecycle.
 *
 * The demo always writes to its own SQLite file, never the real mind.db, so
 * running or resetting the demo can never touch real signals, thoughts, or
 * directions. The file lives at ~/.data/kIiYOSJe/mind/demo.db.
 */

import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { dataDir, openDb } from "@mind/core";
import { ensureFallbackDirection } from "@mind/pipeline";
import type { Db } from "@mind/core";
import { engineerScenario } from "./personas/engineer.js";
import { pmScenario } from "./personas/pm.js";
import { devsecopsScenario } from "./personas/devsecops.js";
import { replayPersona } from "./replay.js";
import type { ReplayResult } from "./replay.js";
import type { PersonaScenario } from "./types.js";

export const ALL_PERSONAS: PersonaScenario[] = [engineerScenario, pmScenario, devsecopsScenario];

export function demoDbPath(): string {
  return join(dataDir(), "demo.db");
}

/** Deletes the demo database and its WAL/SHM sidecar files, if present. */
export function resetDemoDb(): void {
  const base = demoDbPath();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = base + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

/**
 * Opens the demo database (creating and migrating it if needed) and seeds
 * every persona scenario into it. Idempotent at the database level via the
 * pipeline's normal dedupe — but for a clean demo, call resetDemoDb() first.
 */
export async function seedDemo(
  directionsRoot: string,
  personas: PersonaScenario[] = ALL_PERSONAS,
): Promise<{ db: Db; results: ReplayResult[] }> {
  const db = openDb(demoDbPath());
  ensureFallbackDirection(db);

  const results: ReplayResult[] = [];
  for (const persona of personas) {
    const result = await replayPersona(db, persona, directionsRoot);
    results.push(result);
  }

  return { db, results };
}
