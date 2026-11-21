/**
 * Background escalation checker.
 *
 * Runs on a fixed interval (default 60 s).  For every thought whose
 * escalateBy has passed and state is still 'seedling', it promotes the thought
 * to 'active' and writes an audit event.  Active thoughts appear at the top
 * of the brief; seedlings are quieter.
 *
 * The checker does not push notifications — it only updates state so the
 * brief reflects reality when you open it.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@mind/core";
import { thoughts, events, newId, logger } from "@mind/core";

const DEFAULT_INTERVAL_MS = 60_000;

export function startEscalationChecker(db: Db, intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  return setInterval(() => runCheck(db), intervalMs);
}

export function runCheck(db: Db): void {
  const now = new Date().toISOString();

  // Find seedling thoughts whose escalateBy has passed.
  const overdue = db
    .select({ id: thoughts.id, title: thoughts.title })
    .from(thoughts)
    .where(
      sql`
        ${thoughts.state} = 'seedling'
        and ${thoughts.escalateBy} is not null
        and ${thoughts.escalateBy} <= ${now}
      `,
    )
    .all();

  if (overdue.length === 0) return;

  for (const t of overdue) {
    db.update(thoughts)
      .set({ state: "active", updatedAt: now })
      .where(sql`${thoughts.id} = ${t.id}`)
      .run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "system",
        kind: "thought.escalated",
        payload: JSON.stringify({ thoughtId: t.id, promotedAt: now }),
      })
      .run();

    logger.info({ thoughtId: t.id, title: t.title }, "thought escalated: deadline passed");
  }
}
