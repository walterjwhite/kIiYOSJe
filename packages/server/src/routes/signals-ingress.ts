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
import { and, eq, desc, sql } from "drizzle-orm";
import { ingest } from "@mind/pipeline";
import type { AdapterRegistry } from "@mind/pipeline";
import {
  signals,
  directions,
  thoughts,
  actions,
  events,
  newId,
  parseCommitment,
  ReclassifySignalRequestSchema,
} from "@mind/core";
import type { Db, NewSignal } from "@mind/core";

const NewSignalSchema = z.object({
  adapter: z.string(),
  account: z.string().nullable().optional(),
  externalId: z.string(),
  dedupeId: z.string().optional(),
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
    const account = c.req.query("account");

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
    if (account) conditions.push(sql`${signals.account} = ${account}`);

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

  /**
   * GET /signals/:id/explain — the full trail for one decision: the signal, the
   * Direction it matched, the Thought and commitment it produced, every action,
   * and the audit events. This is what `mind explain <id>` prints, and it is the
   * answer to "why did it do that" without reading the database by hand.
   */
  app.get("/:id/explain", (c) => {
    const { id } = c.req.param();
    const signal = db.select().from(signals).where(eq(signals.id, id)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);

    const direction = signal.directionId
      ? (db
          .select()
          .from(directions)
          .where(eq(directions.id, signal.directionId))
          .get() ?? null)
      : null;

    const thought = signal.thoughtId
      ? (db.select().from(thoughts).where(eq(thoughts.id, signal.thoughtId)).get() ??
        null)
      : null;

    const relatedActions = db
      .select()
      .from(actions)
      .where(eq(actions.signalId, id))
      .all();

    const threadCondition = signal.threadId
      ? sql` or json_extract(${events.payload}, '$.threadId') = ${signal.threadId}`
      : sql``;
    const relatedEvents = db
      .select()
      .from(events)
      .where(
        sql`json_extract(${events.payload}, '$.signalId') = ${id}${threadCondition}`,
      )
      .orderBy(desc(events.at))
      .all();

    return c.json({
      signal,
      direction: direction
        ? {
            id: direction.id,
            name: direction.name,
            posture: direction.posture,
            autonomy: direction.autonomy,
            confidenceMin: direction.confidenceMin,
            enabled: direction.enabled,
            standard: direction.standard,
          }
        : null,
      thought,
      commitment: thought ? parseCommitment(thought.commitment) : null,
      actions: relatedActions,
      events: relatedEvents,
    });
  });

  /**
   * POST /signals/:id/undo — reverse a decision that did not send anything.
   *
   * Reclassify covers "the match was wrong"; this covers "it filed something it
   * should have kept". Refused once a reply from this signal has gone out,
   * because an outbound message cannot be undone by clearing a row. Borrowed
   * from smartmail's undo (references.md §2.3); the audit trail is kept — the
   * signal goes back to `new`, its proposed actions are discarded, and one
   * `signal.undone` event records what was reversed.
   */
  app.post("/:id/undo", (c) => {
    const { id } = c.req.param();
    const signal = db.select().from(signals).where(eq(signals.id, id)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);
    if (signal.disposition === "new") {
      return c.json({ error: "Nothing to undo" }, 409);
    }

    const relatedActions = db
      .select()
      .from(actions)
      .where(eq(actions.signalId, id))
      .all();

    const sent = relatedActions.filter((action) => action.status === "sent");
    if (sent.length > 0) {
      return c.json(
        {
          error: "Cannot undo: a reply from this signal was already sent",
          actionIds: sent.map((action) => action.id),
        },
        409,
      );
    }

    for (const action of relatedActions) {
      if (action.status === "proposed" || action.status === "failed") {
        db.update(actions)
          .set({ status: "discarded" })
          .where(eq(actions.id, action.id))
          .run();
      }
    }

    // Close the Thought only if this signal is what created it; a Thought that
    // gathered several signals stays open for the others.
    if (signal.thoughtId) {
      const siblings =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(
            and(
              eq(signals.thoughtId, signal.thoughtId),
              sql`${signals.id} != ${id}`,
            ),
          )
          .get()?.count ?? 0;

      if (siblings === 0) {
        db.update(thoughts)
          .set({ state: "closed", updatedAt: new Date().toISOString() })
          .where(eq(thoughts.id, signal.thoughtId))
          .run();
      }
    }

    db.update(signals)
      .set({ disposition: "new", thoughtId: null })
      .where(eq(signals.id, id))
      .run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "signal.undone",
        payload: JSON.stringify({
          signalId: id,
          previousDisposition: signal.disposition,
          thoughtId: signal.thoughtId,
          actionIds: relatedActions.map((action) => action.id),
        }),
      })
      .run();

    return c.json({
      ok: true,
      previousDisposition: signal.disposition,
      revertedActions: relatedActions.length,
      thoughtClosed: signal.thoughtId !== null,
    });
  });

  return app;
}
