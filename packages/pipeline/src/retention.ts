/**
 * Signal body retention job.
 *
 * Redacts the body of signals older than retentionDays() that have not already
 * been redacted.  Runs once immediately, then on a configurable interval
 * (default 6 hours).
 */

import { sql, lt, and, notLike } from "drizzle-orm";
import type { Db } from "@mind/core";
import { signals, events, retentionDays, newId, logger } from "@mind/core";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function runRetention(db: Db): void {
  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const redactedPrefix = "[redacted";
  const marker = `[redacted after ${days}d]`;

  // Find signals older than the retention window whose body has not been redacted.
  const stale = db
    .select({ id: signals.id })
    .from(signals)
    .where(
      and(
        lt(signals.receivedAt, cutoff),
        notLike(signals.body, `${redactedPrefix}%`),
      ),
    )
    .all();

  const count = stale.length;
  if (count === 0) {
    logger.info({ retentionDays: days }, "retention: nothing to redact");
    return;
  }

  for (const row of stale) {
    db.update(signals)
      .set({ body: marker })
      .where(sql`${signals.id} = ${row.id}`)
      .run();
  }

  db.insert(events)
    .values({
      id: newId(),
      actor: "system",
      kind: "signals.redacted",
      payload: JSON.stringify({ count }),
    })
    .run();

  logger.info({ count, retentionDays: days }, "retention: redacted signal bodies");
}

export function startRetentionJob(
  db: Db,
  intervalMs = DEFAULT_INTERVAL_MS,
): NodeJS.Timeout {
  runRetention(db);
  return setInterval(() => runRetention(db), intervalMs);
}
