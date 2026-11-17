/**
 * GET /events — the Journal. Read-only view over the append-only audit log.
 * Nothing here is ever edited or deleted; the extension's Journal tab is
 * a filtered window onto this table, not a separate log.
 */

import { Hono } from "hono";
import { desc, sql } from "drizzle-orm";
import { events } from "@mind/core";
import type { Db } from "@mind/core";

export function eventsRouter(db: Db) {
  const app = new Hono();

  // GET /events?kind=&actor=&since=&limit=
  app.get("/", (c) => {
    const kind = c.req.query("kind");
    const actor = c.req.query("actor");
    const since = c.req.query("since");
    const limit = Math.min(Number(c.req.query("limit") ?? "200") || 200, 1000);

    const conditions: ReturnType<typeof sql>[] = [];
    if (kind) conditions.push(sql`${events.kind} = ${kind}`);
    if (actor) conditions.push(sql`${events.actor} = ${actor}`);
    if (since) conditions.push(sql`${events.at} >= ${since}`);

    const whereClause =
      conditions.length > 0 ? sql.join(conditions, sql` and `) : undefined;

    const rows = whereClause
      ? db.select().from(events).where(whereClause).orderBy(desc(events.at)).limit(limit).all()
      : db.select().from(events).orderBy(desc(events.at)).limit(limit).all();

    return c.json(rows);
  });

  return app;
}
