/**
 * Retries signals held because the model was unavailable (deferral.ts).
 *
 * Every tick it looks at signals still in disposition `new`, finds each one's
 * latest `signal.deferred` event, and processes those whose retry time has come,
 * through the same `ingest()` path as a new signal. While the circuit breaker is
 * open the tick does nothing, so a pause does not use up anyone's tries. At most
 * BATCH signals are tried per tick, which keeps a backlog from flooding a
 * provider that has just come back.
 */

import type { Db, NewSignal } from "@mind/core";
import { events, logger, signals } from "@mind/core";
import { desc, eq } from "drizzle-orm";
import type { AdapterRegistry } from "./adapter-registry.js";
import { ingest } from "./ingest.js";
import { resilienceState } from "./resilience.js";

const BATCH = 3;
const TICK_MS = 30_000;
/** Newest deferral events read per tick. A backlog beyond this waits for the next tick. */
const EVENT_SCAN_LIMIT = 1_000;

interface Deferral {
  signalId: string;
  attempt: number;
  nextAttemptAt: string;
}

function latestDeferrals(db: Db): Map<string, Deferral> {
  const rows = db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.kind, "signal.deferred"))
    .orderBy(desc(events.at))
    .limit(EVENT_SCAN_LIMIT)
    .all();
  const latest = new Map<string, Deferral>();
  for (const row of rows) {
    try {
      const p = JSON.parse(row.payload) as Partial<Deferral>;
      if (typeof p.signalId !== "string" || typeof p.nextAttemptAt !== "string") continue;
      // Newest first, so the first one seen per signal is its latest.
      if (!latest.has(p.signalId)) {
        latest.set(p.signalId, {
          signalId: p.signalId,
          attempt: typeof p.attempt === "number" ? p.attempt : 1,
          nextAttemptAt: p.nextAttemptAt,
        });
      }
    } catch {
      /* an unreadable event schedules nothing */
    }
  }
  return latest;
}

/** Signals waiting for the model whose retry time has come, oldest first. */
export function dueDeferrals(db: Db, now: Date): Deferral[] {
  const waiting = new Set(
    db
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.disposition, "new"))
      .all()
      .map((r) => r.id),
  );
  return [...latestDeferrals(db).values()]
    .filter((d) => waiting.has(d.signalId) && Date.parse(d.nextAttemptAt) <= now.getTime())
    .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt));
}

/** How many signals are waiting for the model. For `/health`. */
export function deferredCount(db: Db): number {
  const waiting = new Set(
    db
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.disposition, "new"))
      .all()
      .map((r) => r.id),
  );
  let n = 0;
  for (const id of latestDeferrals(db).keys()) if (waiting.has(id)) n++;
  return n;
}

function toNewSignal(row: typeof signals.$inferSelect): NewSignal {
  return {
    adapter: row.adapter,
    ...(row.account ? { account: row.account } : {}),
    externalId: row.externalId,
    threadId: row.threadId,
    sender: row.sender,
    recipients: JSON.parse(row.recipients) as string[],
    ...(row.cc ? { cc: JSON.parse(row.cc) as string[] } : {}),
    ...(row.bcc ? { bcc: JSON.parse(row.bcc) as string[] } : {}),
    kind: row.kind,
    ...(row.subject ? { subject: row.subject } : {}),
    body: row.body,
    ...(row.htmlBody ? { htmlBody: row.htmlBody } : {}),
    receivedAt: new Date(row.receivedAt),
    urgencyHint: row.urgencyHint,
  };
}

/** One pass. Returns how many signals were tried. */
export async function retryDeferred(
  db: Db,
  adapters: AdapterRegistry,
  now: Date = new Date(),
): Promise<number> {
  if (resilienceState().circuit === "open") return 0;

  let tried = 0;
  for (const due of dueDeferrals(db, now).slice(0, BATCH)) {
    const row = db.select().from(signals).where(eq(signals.id, due.signalId)).get();
    if (!row) continue;
    try {
      await ingest(db, toNewSignal(row), adapters, {
        resume: { signalId: row.id, attempt: due.attempt },
      });
      tried++;
    } catch (err) {
      // Unexpected: leave the signal for the next tick and say so without content.
      logger.error(
        { signalId: row.id, errorType: err instanceof Error ? err.name : typeof err },
        "deferred retry failed",
      );
    }
  }
  return tried;
}

export function startDeferredRetry(
  db: Db,
  adapters: AdapterRegistry,
  intervalMs = TICK_MS,
): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    retryDeferred(db, adapters)
      .catch((err: unknown) =>
        logger.error(
          { errorType: err instanceof Error ? err.name : typeof err },
          "retry tick failed",
        ),
      )
      .finally(() => {
        running = false;
      });
  }, intervalMs);
}
