import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { signals, thoughts } from "@mind/core";
import type { Db } from "@mind/core";

export function metricsRouter(db: Db) {
  const app = new Hono();

  // GET /metrics?window=7d (default 7d)
  app.get("/", (c) => {
    const window = c.req.query("window") ?? "7d";
    const days = parseDays(window);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const signalCount = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(sql`${signals.receivedAt} >= ${since}`)
      .get();

    const thoughtCount = db
      .select({ count: sql<number>`count(*)` })
      .from(thoughts)
      .where(sql`${thoughts.createdAt} >= ${since}`)
      .get();

    const absorbs = db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        sql`${signals.receivedAt} >= ${since} and ${signals.disposition} = 'absorbed'`,
      )
      .get();

    const signalsPerWeek = signalCount?.count ?? 0;
    const thoughtsPerWeek = thoughtCount?.count ?? 0;

    return c.json({
      window,
      signals: signalsPerWeek,
      thoughts: thoughtsPerWeek,
      ratio:
        thoughtsPerWeek > 0
          ? +(signalsPerWeek / thoughtsPerWeek).toFixed(2)
          : null,
      absorbed: absorbs?.count ?? 0,
    });
  });

  return app;
}

function parseDays(window: string): number {
  if (window.endsWith("d")) return parseInt(window.slice(0, -1), 10) || 7;
  if (window.endsWith("w")) return (parseInt(window.slice(0, -1), 10) || 1) * 7;
  return 7;
}
