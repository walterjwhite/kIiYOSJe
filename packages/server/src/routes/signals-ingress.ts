/**
 * /signals — ingress (adapter → pipeline) plus read/reclassify for the
 * extension's Signals view.
 *
 * POST /     — internal ingress endpoint. Only reachable from localhost;
 *              guarded by bearer auth. Adapters that cannot call back (e.g.
 *              a CLI pipe) can POST here instead of using the in-process sink.
 * GET /      — list signals, newest first, optionally ranged by receivedAt
 *              and filtered by direction.
 * PATCH /:id — reclassify: move a signal to a different direction. The
 *              match itself was wrong, as opposed to an override of a
 *              correct match's draft (that's /actions/:id/discard). Logged
 *              as a `signal.reclassified` event so Learnings can show the
 *              correction alongside override-driven proposals.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, sql } from "drizzle-orm";
import { ingest } from "@mind/pipeline";
import type { AdapterRegistry } from "@mind/pipeline";
import { signals, directions, events, newId, ReclassifySignalRequestSchema } from "@mind/core";
import type { Db, NewSignal } from "@mind/core";

const NewSignalSchema = z.object({
  adapter: z.string(),
  externalId: z.string(),
  threadId: z.string().nullable(),
  sender: z.string().email(),
  recipients: z.array(z.string()),
  kind: z.string(),
  body: z.string(),
  receivedAt: z.string().datetime(),
  urgencyHint: z.number().nullable(),
});

const RANGE_DAYS: Record<string, number | null> = {
  today: 0,
  "7d": 7,
  "30d": 30,
  all: null,
};

export function signalsRouter(db: Db, adapters: AdapterRegistry) {
  const app = new Hono();

  app.post("/", zValidator("json", NewSignalSchema), async (c) => {
    const raw = c.req.valid("json");
    const signal: NewSignal = {
      ...raw,
      receivedAt: new Date(raw.receivedAt),
    };

    // Full result, not just the disposition: callers can follow the ids to
    // the signal, Thought, and proposed action without a second request.
    const result = await ingest(db, signal, adapters);
    return c.json(result, result.disposition === "duplicate" ? 200 : 201);
  });

  // GET /signals?range=today|7d|30d|all&directionId=&adapter=
  app.get("/", (c) => {
    const range = c.req.query("range") ?? "today";
    const directionId = c.req.query("directionId");
    const adapter = c.req.query("adapter");

    const days = RANGE_DAYS[range] ?? 0;
    const since =
      days === null
        ? null
        : days === 0
          ? (() => {
              const d = new Date();
              d.setHours(0, 0, 0, 0);
              return d.toISOString();
            })()
          : new Date(Date.now() - days * 86_400_000).toISOString();

    const conditions: ReturnType<typeof sql>[] = [];
    if (since) conditions.push(sql`${signals.receivedAt} >= ${since}`);
    if (directionId) conditions.push(sql`${signals.directionId} = ${directionId}`);
    if (adapter) conditions.push(sql`${signals.adapter} = ${adapter}`);

    const whereClause =
      conditions.length > 0 ? sql.join(conditions, sql` and `) : undefined;

    const rows = whereClause
      ? db.select().from(signals).where(whereClause).orderBy(desc(signals.receivedAt)).all()
      : db.select().from(signals).orderBy(desc(signals.receivedAt)).all();

    return c.json(rows);
  });

  // PATCH /signals/:id — reclassify to a different direction
  app.patch(
    "/:id",
    zValidator("json", ReclassifySignalRequestSchema),
    (c) => {
      const { id } = c.req.param();
      const { directionId, reason } = c.req.valid("json");

      const signal = db.select().from(signals).where(eq(signals.id, id)).get();
      if (!signal) return c.json({ error: "Not found" }, 404);

      const direction = db
        .select({ id: directions.id })
        .from(directions)
        .where(eq(directions.id, directionId))
        .get();
      if (!direction) return c.json({ error: "Unknown directionId" }, 422);

      const fromDirectionId = signal.directionId;

      db.update(signals)
        .set({ directionId })
        .where(eq(signals.id, id))
        .run();

      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "signal.reclassified",
          payload: JSON.stringify({
            signalId: id,
            fromDirectionId,
            toDirectionId: directionId,
            reason: reason ?? null,
          }),
        })
        .run();

      return c.json({ ok: true, fromDirectionId, toDirectionId: directionId });
    },
  );

  return app;
}
