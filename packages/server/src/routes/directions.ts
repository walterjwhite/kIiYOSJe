import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { directions, events, signals, actions, newId, UpdateDirectionRequestSchema } from "@mind/core";
import type { Db } from "@mind/core";

export function directionsRouter(db: Db) {
  const app = new Hono();

  // GET /directions — all directions with signal/action counts
  app.get("/", (c) => {
    const rows = db.select().from(directions).all();

    const enriched = rows.map((dir) => {
      const totalSignals =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(eq(signals.directionId, dir.id))
          .get()?.count ?? 0;

      const absorbedSignals =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(
            sql`${signals.directionId} = ${dir.id} and ${signals.disposition} = 'absorbed'`,
          )
          .get()?.count ?? 0;

      // Actions linked via signalId → signals → directionId
      const proposedActions =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${dir.id} and ${actions.status} = 'proposed'`,
          )
          .get()?.count ?? 0;

      const discardedActions =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${dir.id} and ${actions.status} = 'discarded'`,
          )
          .get()?.count ?? 0;

      const totalDecidedActions =
        db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${dir.id} and ${actions.status} in ('proposed','sent','discarded')`,
          )
          .get()?.count ?? 0;

      return {
        ...dir,
        signals: totalSignals,
        absorbed: absorbedSignals,
        proposed: proposedActions,
        discarded: discardedActions,
        overrideRate:
          totalDecidedActions > 0
            ? +(discardedActions / totalDecidedActions).toFixed(4)
            : null,
      };
    });

    return c.json(enriched);
  });

  // PUT /directions/:id — update guarded fields, plus name/standard/prompts
  app.put(
    "/:id",
    zValidator("json", UpdateDirectionRequestSchema),
    (c) => {
      const { id } = c.req.param();
      const body = c.req.valid("json");
      const now = new Date().toISOString();

      const existing = db
        .select()
        .from(directions)
        .where(eq(directions.id, id))
        .get();

      if (!existing) return c.json({ error: "Not found" }, 404);

      db.update(directions)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.posture !== undefined ? { posture: body.posture } : {}),
          ...(body.autonomy !== undefined ? { autonomy: body.autonomy } : {}),
          ...(body.confidenceMin !== undefined
            ? { confidenceMin: body.confidenceMin }
            : {}),
          ...(body.standard !== undefined ? { standard: body.standard } : {}),
          ...(body.matchPrompt !== undefined
            ? { matchPrompt: body.matchPrompt }
            : {}),
          ...(body.responsePrompt !== undefined
            ? { responsePrompt: body.responsePrompt }
            : {}),
          version: existing.version + 1,
          updatedAt: now,
        })
        .where(eq(directions.id, id))
        .run();

      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "direction.updated",
          payload: JSON.stringify({ directionId: id, changes: body }),
        })
        .run();

      return c.json({ ok: true });
    },
  );

  return app;
}
