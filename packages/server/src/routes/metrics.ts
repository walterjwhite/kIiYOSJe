import type { Db } from "@mind/core";
import { actions, directions, events, signals, thoughts } from "@mind/core";
import {
  COVERAGE_TARGET,
  FALLBACK_DIRECTION_ID,
  linkCorrections,
  WEEK_MS,
  weeklyCoverage,
} from "@mind/pipeline";
import { eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";

export function metricsRouter(db: Db) {
  const app = new Hono();

  // GET /metrics/flow?window=7d — how signals moved: channel, the Direction
  // that matched, and what became of them. One row per combination, so the
  // extension can draw the flow and every line in it can be drilled into.
  app.get("/flow", (c) => {
    const since = new Date(
      Date.now() - parseDays(c.req.query("window") ?? "7d") * 86_400_000,
    ).toISOString();
    const rows = db
      .select({
        adapter: signals.adapter,
        directionId: signals.directionId,
        directionName: directions.name,
        disposition: signals.disposition,
        count: sql<number>`count(*)`,
      })
      .from(signals)
      .leftJoin(directions, eq(directions.id, signals.directionId))
      .where(gte(signals.receivedAt, since))
      .groupBy(signals.adapter, signals.directionId, signals.disposition)
      .all();
    return c.json({ window: c.req.query("window") ?? "7d", links: rows });
  });

  // GET /metrics/signals?directionId=&adapter=&day=YYYY-MM-DD&week=YYYY-MM-DD&disposition=&window=7d
  // Analytics drill-down: the signals behind one bar, row, node, line or week
  // of the summary. At least one filter is required so this can't silently
  // return the whole table; `window` only narrows it further. `week` is the
  // Monday that starts a coverage bucket, and covers that seven-day span.
  app.get("/signals", (c) => {
    const directionId = c.req.query("directionId");
    const adapter = c.req.query("adapter");
    const day = c.req.query("day");
    const week = c.req.query("week");
    const disposition = c.req.query("disposition");
    const window = c.req.query("window");

    if (!directionId && !adapter && !day && !week && !disposition) {
      return c.json(
        { error: "Provide at least one of directionId, adapter, day, week, disposition" },
        400,
      );
    }

    let weekStart: number | null = null;
    if (week) {
      weekStart = Date.parse(`${week.slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(weekStart)) {
        return c.json({ error: "week must be a YYYY-MM-DD date" }, 400);
      }
    }

    const conditions: ReturnType<typeof sql>[] = [];
    if (disposition) conditions.push(sql`${signals.disposition} = ${disposition}`);
    if (window) {
      const since = new Date(Date.now() - parseDays(window) * 86_400_000).toISOString();
      conditions.push(sql`${signals.receivedAt} >= ${since}`);
    }
    if (directionId) conditions.push(sql`${signals.directionId} = ${directionId}`);
    if (adapter) conditions.push(sql`${signals.adapter} = ${adapter}`);
    if (day) {
      conditions.push(sql`substr(${signals.receivedAt}, 1, 10) = ${day}`);
    }
    if (weekStart != null) {
      conditions.push(sql`${signals.receivedAt} >= ${new Date(weekStart).toISOString()}`);
      conditions.push(
        sql`${signals.receivedAt} < ${new Date(weekStart + 7 * 86_400_000).toISOString()}`,
      );
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

  // GET /metrics/coverage?weeks=12 — the curve, not the total. Absorb rate per
  // week against the number of Directions in force, which is the only version
  // of the claim that can fail. See DIRECTION.md §3 and references.md.
  app.get("/coverage", (c) => {
    const weeks = Math.min(Math.max(Number(c.req.query("weeks") ?? "12") || 12, 1), 52);
    const since = new Date(Date.now() - (weeks + 1) * WEEK_MS).toISOString();

    const signalRows = db
      .select({
        receivedAt: signals.receivedAt,
        disposition: signals.disposition,
        directionId: signals.directionId,
        awaitingReplyAt: signals.awaitingReplyAt,
        replyReceivedAt: signals.replyReceivedAt,
      })
      .from(signals)
      .where(gte(signals.receivedAt, since))
      .all();

    // Explicit Directions only. The catch-all matches everything, so counting
    // its absorptions would let the rate rise without any authored policy
    // improving — the exact mistake STATUS gap #8 warns about.
    const excludedFallback = signalRows.filter(
      (row) => row.directionId === FALLBACK_DIRECTION_ID,
    ).length;
    const explicitRows = signalRows.filter((row) => row.directionId !== FALLBACK_DIRECTION_ID);

    const thoughtRows = db
      .select({ createdAt: thoughts.createdAt })
      .from(thoughts)
      .where(gte(thoughts.createdAt, since))
      .all();

    const directionRows = db
      .select({ createdAt: directions.createdAt, enabled: directions.enabled })
      .from(directions)
      .all();

    return c.json({
      scope: "explicit-directions",
      // How many signals were left out of the rate because no authored
      // Direction covered them. If this grows, coverage is not growing.
      excludedFallback,
      ...weeklyCoverage(
        {
          signals: explicitRows,
          thoughts: thoughtRows,
          directions: directionRows,
        },
        { weeks, target: COVERAGE_TARGET },
      ),
    });
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
        .where(sql`${signals.receivedAt} >= ${since} and ${signals.disposition} = 'absorbed'`)
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
        avgMs: sql<
          number | null
        >`avg((julianday(${thoughts.updatedAt}) - julianday(${thoughts.createdAt})) * 86400000)`,
      })
      .from(thoughts)
      .where(sql`${thoughts.state} in ('closed','parked') and ${thoughts.updatedAt} >= ${since}`)
      .get();

    // Sends without revert — actions with status='sent' in window
    const sentCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(actions)
        .where(sql`${actions.createdAt} >= ${since} and ${actions.status} = 'sent'`)
        .get()?.count ?? 0;

    // Per-direction stats
    const directionRows = db.select().from(directions).all();
    const byDirection = directionRows.map((dir) => {
      const dirSignals =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(sql`${signals.receivedAt} >= ${since} and ${signals.directionId} = ${dir.id}`)
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
        overrideRate: dirTotalActions > 0 ? +(dirOverrides / dirTotalActions).toFixed(4) : null,
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

    // Automatic goal links the operator later undid. Corrections arrive after
    // the link, so both kinds of event are read from the start of the window.
    const autoLink = linkCorrections(
      db
        .select({ at: events.at, actor: events.actor, kind: events.kind, payload: events.payload })
        .from(events)
        .where(
          sql`${events.at} >= ${since} and ${events.kind} in ('signal.thought_linked', 'signal.thought_unlinked')`,
        )
        .all(),
    );

    return c.json({
      window,
      autoLink,
      signals: signalCount,
      thoughts: thoughtCount,
      ratio: thoughtCount > 0 ? +(signalCount / thoughtCount).toFixed(2) : null,
      absorbed: absorbedCount,
      absorbRate: signalCount > 0 ? +(absorbedCount / signalCount).toFixed(4) : null,
      overrideRate: totalActions > 0 ? +(discardedActions / totalActions).toFixed(4) : null,
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
