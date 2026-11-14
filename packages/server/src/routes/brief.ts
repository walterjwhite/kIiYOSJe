import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { thoughts, actions, directions, signals } from "@mind/core";
import type { Db } from "@mind/core";

export function briefRouter(db: Db) {
  const app = new Hono();

  // GET /brief — today's summary payload
  app.get("/", (c) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = todayStart.toISOString();
    const now = new Date().toISOString();

    // Active thoughts: explicitly promoted by the escalation checker or by the user.
    const activeThoughts = db
      .select()
      .from(thoughts)
      .where(eq(thoughts.state, "active"))
      .all();

    // New seedlings created today (not yet overdue).
    const newSeedlings = db
      .select()
      .from(thoughts)
      .where(
        sql`
          ${thoughts.state} = 'seedling'
          and ${thoughts.createdAt} >= ${since}
          and (${thoughts.escalateBy} is null or ${thoughts.escalateBy} > ${now})
        `,
      )
      .all();

    // Overdue seedlings: escalateBy in the past but not yet promoted (checker
    // runs async; this catches the gap before the next tick).
    const overdueThoughts = db
      .select()
      .from(thoughts)
      .where(
        sql`
          ${thoughts.state} = 'seedling'
          and ${thoughts.escalateBy} is not null
          and ${thoughts.escalateBy} <= ${now}
        `,
      )
      .all();

    // Thoughts with reviewAt due (any state except closed).
    const reviewDue = db
      .select()
      .from(thoughts)
      .where(
        sql`
          ${thoughts.reviewAt} is not null
          and ${thoughts.reviewAt} <= ${now}
          and ${thoughts.state} != 'closed'
        `,
      )
      .all();

    const proposed = db
      .select()
      .from(actions)
      .where(eq(actions.status, "proposed"))
      .all();

    const absorbedToday = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        sql`${signals.receivedAt} >= ${since} and ${signals.disposition} = 'absorbed'`,
      )
      .get();

    const activeDirections = db
      .select({ id: directions.id, name: directions.name, posture: directions.posture })
      .from(directions)
      .where(eq(directions.enabled, true))
      .all();

    return c.json({
      date: new Date().toISOString().slice(0, 10),
      thoughts: {
        active: activeThoughts,
        overdue: overdueThoughts,
        reviewDue,
        newToday: newSeedlings,
      },
      actions: { proposed },
      absorb: { today: absorbedToday?.count ?? 0 },
      directions: { active: activeDirections },
    });
  });

  return app;
}
