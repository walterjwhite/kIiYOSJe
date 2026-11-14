import { Hono } from "hono";
import { eq, sql, and } from "drizzle-orm";
import { thoughts, actions, directions, signals } from "@mind/core";
import type { Db } from "@mind/core";

export function briefRouter(db: Db) {
  const app = new Hono();

  // GET /brief — today's summary payload
  app.get("/", (c) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = todayStart.toISOString();

    const activeThoughts = db
      .select()
      .from(thoughts)
      .where(sql`${thoughts.state} in ('active', 'seedling')`)
      .all();

    const proposed = db
      .select()
      .from(actions)
      .where(eq(actions.status, "proposed"))
      .all();

    const reviewDue = db
      .select()
      .from(thoughts)
      .where(
        sql`${thoughts.reviewAt} is not null and ${thoughts.reviewAt} <= datetime('now') and ${thoughts.state} != 'closed'`,
      )
      .all();

    const absorbedToday = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        sql`${signals.receivedAt} >= ${since} and ${signals.disposition} = 'absorbed'`,
      )
      .get();

    const escalatedToday = db
      .select()
      .from(thoughts)
      .where(sql`${thoughts.createdAt} >= ${since} and ${thoughts.state} = 'seedling'`)
      .all();

    const activeDirections = db
      .select({ id: directions.id, name: directions.name })
      .from(directions)
      .where(eq(directions.enabled, true))
      .all();

    return c.json({
      date: new Date().toISOString().slice(0, 10),
      thoughts: {
        active: activeThoughts,
        reviewDue,
        escalatedToday,
      },
      actions: { proposed },
      absorb: {
        today: absorbedToday?.count ?? 0,
      },
      directions: { active: activeDirections },
    });
  });

  return app;
}
