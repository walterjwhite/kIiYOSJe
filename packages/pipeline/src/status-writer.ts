/**
 * Keeps ~/.data/kIiYOSJe/mind/status.json up to date.
 *
 * Written on a 30-second interval and after each signal is ingested.
 * The status file is what `mind health` and GET /admin/status read.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@mind/core";
import {
  signals,
  thoughts,
  writeStatus,
  globalSendEnabled,
  pausedFlagPath,
  logger,
} from "@mind/core";
import { existsSync } from "node:fs";
import type { AdapterRegistry } from "./adapter-registry.js";

const VERSION = "0.0.1";
const DEFAULT_INTERVAL_MS = 30_000;

let _startedAt: string = new Date().toISOString();

export function markStarted(): void {
  _startedAt = new Date().toISOString();
}

export function startStatusWriter(
  db: Db,
  adapters: AdapterRegistry,
  intervalMs = DEFAULT_INTERVAL_MS,
): NodeJS.Timeout {
  markStarted();
  updateStatus(db, adapters);
  return setInterval(() => updateStatus(db, adapters), intervalMs);
}

export function updateStatus(db: Db, adapters: AdapterRegistry): void {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = todayStart.toISOString();

    const lastSignalRow = db
      .select({ receivedAt: signals.receivedAt })
      .from(signals)
      .orderBy(sql`${signals.receivedAt} desc`)
      .limit(1)
      .get();

    const signalsTodayRow = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(sql`${signals.receivedAt} >= ${since}`)
      .get();

    const openThoughtsRow = db
      .select({ count: sql<number>`count(*)` })
      .from(thoughts)
      .where(sql`${thoughts.state} in ('seedling', 'active')`)
      .get();

    writeStatus({
      startedAt: _startedAt,
      version: VERSION,
      sendEnabled: globalSendEnabled(),
      paused: existsSync(pausedFlagPath()),
      adapters: adapters.all().map((a) => ({
        id: a.id,
        canSend: a.capabilities.canSend,
        canStream: a.capabilities.canStream,
      })),
      lastSignalAt: lastSignalRow?.receivedAt ?? null,
      signalsToday: signalsTodayRow?.count ?? 0,
      thoughtsOpen: openThoughtsRow?.count ?? 0,
    });
  } catch (err) {
    logger.warn({ err }, "status-writer: failed to write status");
  }
}
