/**
 * /events — the Journal.
 *
 * GET  / — read-only view over the append-only audit log.
 * POST /notes — append an operator-written note (kind='journal.note',
 *               actor='user'). Everything else under /events is written
 *               only by the system as decisions happen; notes are the one
 *               place the operator writes directly into the same log —
 *               dated, free text, never tied to a signal/direction/thought.
 */

import { Hono } from "hono";
import { desc, sql } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { events, newId, CreateJournalNoteRequestSchema } from "@mind/core";
import type { Db } from "@mind/core";

const RANGE_DAYS: Record<string, number | null> = {
  today: 0,
  "7d": 7,
  "30d": 30,
  all: null,
};

/** Hour-granularity ranges, same semantics as /signals' range filter. */
const RANGE_HOURS: Record<string, number> = {
  "1h": 1,
  "4h": 4,
  "12h": 12,
};

export function eventsRouter(db: Db) {
  const app = new Hono();

  // GET /events?kind=&actor=&since=&until=&range=&limit=
  // range accepts the same values as /signals (1h/4h/12h/today/7d/30d/all);
  // since/until, when given, take precedence over range for a fully
  // custom window. With neither given, defaults to all time (unlike
  // /signals, which defaults to today) since the Journal/System Events
  // views both show their own range control rather than assume "today".
  app.get("/", (c) => {
    const kind = c.req.query("kind");
    const actor = c.req.query("actor");
    const range = c.req.query("range");
    const sinceParam = c.req.query("since");
    const untilParam = c.req.query("until");
    const limit = Math.min(Number(c.req.query("limit") ?? "200") || 200, 1000);

    let since: string | null = sinceParam ?? null;
    if (!since && range) {
      if (range in RANGE_HOURS) {
        since = new Date(Date.now() - RANGE_HOURS[range]! * 3_600_000).toISOString();
      } else {
        const days = RANGE_DAYS[range] ?? null;
        since =
          days === null
            ? null
            : days === 0
              ? (() => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  return d.toISOString();
                })()
              : new Date(Date.now() - days * 86_400_000).toISOString();
      }
    }

    const conditions: ReturnType<typeof sql>[] = [];
    if (kind) conditions.push(sql`${events.kind} = ${kind}`);
    if (actor) conditions.push(sql`${events.actor} = ${actor}`);
    if (since) conditions.push(sql`${events.at} >= ${since}`);
    if (untilParam) conditions.push(sql`${events.at} <= ${untilParam}`);

    const whereClause = conditions.length > 0 ? sql.join(conditions, sql` and `) : undefined;

    const rows = whereClause
      ? db.select().from(events).where(whereClause).orderBy(desc(events.at)).limit(limit).all()
      : db.select().from(events).orderBy(desc(events.at)).limit(limit).all();

    return c.json(rows);
  });

  // POST /events/notes — append a journal note
  app.post("/notes", zValidator("json", CreateJournalNoteRequestSchema), (c) => {
    const { text } = c.req.valid("json");
    const id = newId();
    const at = new Date().toISOString();

    db.insert(events)
      .values({
        id,
        at,
        actor: "user",
        kind: "journal.note",
        payload: JSON.stringify({ text }),
      })
      .run();

    return c.json({ id, at }, 201);
  });

  return app;
}
