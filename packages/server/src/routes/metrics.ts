import { Hono } from "hono";
import { sql, eq } from "drizzle-orm";
import { signals, thoughts, actions, directions } from "@mind/core";
import type { Db } from "@mind/core";

export function metricsRouter(db: Db) {
  const app = new Hono();

  // GET /metrics/signals?directionId=&adapter=&day=YYYY-MM-DD
  // Analytics drill-down: the signals behind one bar/row of the summary
  // below. At least one filter is required so this can't silently return
  // the whole table.
  app.get("/signals", (c) => {
    const directionId = c.req.query("directionId");
    const adapter = c.req.query("adapter");
    const day = c.req.query("day");

    if (!directionId && !adapter && !day) {
      return c.json(
        { error: "Provide at least one of directionId, adapter, day" },
        400,
      );
    }

    const conditions: ReturnType<typeof sql>[] = [];
    if (directionId) conditions.push(sql`${signals.directionId} = ${directionId}`);
    if (adapter) conditions.push(sql`${signals.adapter} = ${adapter}`);
    if (day) {
      conditions.push(sql`substr(${signals.receivedAt}, 1, 10) = ${day}`);
    }

    const whereClause = sql.join(conditions, sql` and `);

    const rows = db
      .select()
      .from(signals)
      .where(whereClause)
      .orderBy(sql`${signals.receivedAt} desc`)
      .all();

    return c.json(rows);
  });

  // GET /metrics?window=7d (default 7d)
  app.get("/", (c) => {
    const window = c.req.query("window") ?? "7d";
    const days = parseDays(window);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    // Total signals in window
    const signalCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(signals)
        .where(sql`${signals.receivedAt} >= ${since}`)
        .get()?.count ?? 0;

    // Total thoughts created in window
    const thoughtCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(thoughts)
        .where(sql`${thoughts.createdAt} >= ${since}`)
        .get()?.count ?? 0;

    // Absorbed signals in window
    const absorbedCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(signals)
        .where(
          sql`${signals.receivedAt} >= ${since} and ${signals.disposition} = 'absorbed'`,
        )
        .get()?.count ?? 0;

    // Override rate: discarded / (proposed + sent + discarded) for actions in window
    const actionStatuses = db
      .select({
        status: actions.status,
        count: sql<number>`count(*)`,
      })
      .from(actions)
      .where(
        sql`${actions.createdAt} >= ${since} and ${actions.status} in ('proposed','sent','discarded')`,
      )
      .groupBy(actions.status)
      .all();

    let totalActions = 0;
    let discardedActions = 0;
    for (const row of actionStatuses) {
      totalActions += row.count;
      if (row.status === "discarded") discardedActions += row.count;
    }

    // Avg time to decision (ms) for thoughts closed/parked in window
    const avgTimeRow = db
      .select({
        avgMs: sql<number | null>`avg((julianday(${thoughts.updatedAt}) - julianday(${thoughts.createdAt})) * 86400000)`,
      })
      .from(thoughts)
      .where(
        sql`${thoughts.state} in ('closed','parked') and ${thoughts.updatedAt} >= ${since}`,
      )
      .get();

    // Sends without revert — actions with status='sent' in window
    const sentCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(actions)
        .where(
          sql`${actions.createdAt} >= ${since} and ${actions.status} = 'sent'`,
        )
        .get()?.count ?? 0;

    // Per-direction stats
    const directionRows = db.select().from(directions).all();
    const byDirection = directionRows.map((dir) => {
      const dirSignals =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(
            sql`${signals.receivedAt} >= ${since} and ${signals.directionId} = ${dir.id}`,
          )
          .get()?.count ?? 0;

      const dirAbsorbed =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(
            sql`${signals.receivedAt} >= ${since} and ${signals.directionId} = ${dir.id} and ${signals.disposition} = 'absorbed'`,
          )
          .get()?.count ?? 0;

      // Overrides: discarded actions whose signal belongs to this direction
      const dirOverrides =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${actions.createdAt} >= ${since} and ${signals.directionId} = ${dir.id} and ${actions.status} = 'discarded'`,
          )
          .get()?.count ?? 0;

      const dirTotalActions =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${actions.createdAt} >= ${since} and ${signals.directionId} = ${dir.id} and ${actions.status} in ('proposed','sent','discarded')`,
          )
          .get()?.count ?? 0;

      return {
        id: dir.id,
        name: dir.name,
        signals: dirSignals,
        absorbed: dirAbsorbed,
        absorbRate: dirSignals > 0 ? +(dirAbsorbed / dirSignals).toFixed(4) : null,
        overrides: dirOverrides,
        overrideRate:
          dirTotalActions > 0
            ? +(dirOverrides / dirTotalActions).toFixed(4)
            : null,
      };
    });

    // Per-channel (adapter) stats — clickable bars in Analytics
    const byChannel = db
      .select({
        adapter: signals.adapter,
        count: sql<number>`count(*)`,
      })
      .from(signals)
      .where(sql`${signals.receivedAt} >= ${since}`)
      .groupBy(signals.adapter)
      .all();

    // Daily volume — clickable bars in Analytics, one per calendar day in window
    const dailyVolume = db
      .select({
        day: sql<string>`substr(${signals.receivedAt}, 1, 10)`,
        count: sql<number>`count(*)`,
      })
      .from(signals)
      .where(sql`${signals.receivedAt} >= ${since}`)
      .groupBy(sql`substr(${signals.receivedAt}, 1, 10)`)
      .orderBy(sql`substr(${signals.receivedAt}, 1, 10)`)
      .all();

    return c.json({
      window,
      signals: signalCount,
      thoughts: thoughtCount,
      ratio: thoughtCount > 0 ? +(signalCount / thoughtCount).toFixed(2) : null,
      absorbed: absorbedCount,
      absorbRate: signalCount > 0 ? +(absorbedCount / signalCount).toFixed(4) : null,
      overrideRate:
        totalActions > 0
          ? +(discardedActions / totalActions).toFixed(4)
          : null,
      avgTimeToDecisionMs: avgTimeRow?.avgMs ?? null,
      sendsWithoutRevert: sentCount,
      byDirection,
      byChannel,
      dailyVolume,
    });
  });

  return app;
}

function parseDays(window: string): number {
  if (window.endsWith("d")) return parseInt(window.slice(0, -1), 10) || 7;
  if (window.endsWith("w")) return (parseInt(window.slice(0, -1), 10) || 1) * 7;
  return 7;
}
