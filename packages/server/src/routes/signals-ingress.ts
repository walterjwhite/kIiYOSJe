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
  LinkThoughtRequestSchema,
  SignalActionSchema,
} from "@mind/core";
import type { Db, NewSignal, SignalAction } from "@mind/core";

const NewSignalSchema = z.object({
  adapter: z.string(),
  account: z.string().nullable().optional(),
  externalId: z.string(),
  dedupeId: z.string().optional(),
  threadId: z.string().nullable(),
  sender: z.string().email(),
  recipients: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  kind: z.string(),
  subject: z.string().optional(),
  body: z.string(),
  htmlBody: z.string().optional(),
  receivedAt: z.string().datetime(),
  urgencyHint: z.number().nullable(),
});

const RANGE_DAYS: Record<string, number | null> = {
  today: 0,
  "7d": 7,
  "30d": 30,
  all: null,
};

/** Hour-granularity ranges, checked before RANGE_DAYS so "today" stays the default. */
const RANGE_HOURS: Record<string, number> = {
  "1h": 1,
  "4h": 4,
  "12h": 12,
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

  // GET /signals?range=1h|4h|12h|today|7d|30d|all&directionId=&adapter=&account=
  // &thoughtId=<goal id> limits it to the signals linked to that goal.
  // &since=<ISO>&until=<ISO> (since/until override range entirely, for a
  // fully custom window; range alone covers the common cases).
  app.get("/", (c) => {
    const range = c.req.query("range") ?? "today";
    const directionId = c.req.query("directionId");
    const adapter = c.req.query("adapter");
    const account = c.req.query("account");
    const thoughtId = c.req.query("thoughtId");
    const sinceParam = c.req.query("since");
    const untilParam = c.req.query("until");

    let since: string | null;
    if (sinceParam) {
      since = sinceParam;
    } else if (range in RANGE_HOURS) {
      since = new Date(Date.now() - RANGE_HOURS[range]! * 3_600_000).toISOString();
    } else {
      const days = RANGE_DAYS[range] ?? 0;
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

    const conditions: ReturnType<typeof sql>[] = [];
    if (since) conditions.push(sql`${signals.receivedAt} >= ${since}`);
    if (untilParam) conditions.push(sql`${signals.receivedAt} <= ${untilParam}`);
    if (directionId) conditions.push(sql`${signals.directionId} = ${directionId}`);
    if (adapter) conditions.push(sql`${signals.adapter} = ${adapter}`);
    if (account) conditions.push(sql`${signals.account} = ${account}`);
    if (thoughtId) conditions.push(sql`${signals.thoughtId} = ${thoughtId}`);

    const whereClause = conditions.length > 0 ? sql.join(conditions, sql` and `) : undefined;

    const rows = whereClause
      ? db.select().from(signals).where(whereClause).orderBy(desc(signals.receivedAt)).all()
      : db.select().from(signals).orderBy(desc(signals.receivedAt)).all();

    return c.json(rows);
  });

  // PATCH /signals/:id — reclassify to a different direction
  app.patch("/:id", zValidator("json", ReclassifySignalRequestSchema), (c) => {
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

    db.update(signals).set({ directionId }).where(eq(signals.id, id)).run();

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
  });

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
      ? (db.select().from(directions).where(eq(directions.id, signal.directionId)).get() ?? null)
      : null;

    const thought = signal.thoughtId
      ? (db.select().from(thoughts).where(eq(thoughts.id, signal.thoughtId)).get() ?? null)
      : null;

    const relatedActions = db.select().from(actions).where(eq(actions.signalId, id)).all();

    const threadCondition = signal.threadId
      ? sql` or json_extract(${events.payload}, '$.threadId') = ${signal.threadId}`
      : sql``;
    const relatedEvents = db
      .select()
      .from(events)
      .where(sql`json_extract(${events.payload}, '$.signalId') = ${id}${threadCondition}`)
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
            signalActions: parseSignalActions(direction.signalActions),
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

    const relatedActions = db.select().from(actions).where(eq(actions.signalId, id)).all();

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
        db.update(actions).set({ status: "discarded" }).where(eq(actions.id, action.id)).run();
      }
    }

    // Close the Thought only if this signal is what created it; a Thought that
    // gathered several signals stays open for the others.
    if (signal.thoughtId) {
      const siblings =
        db
          .select({ count: sql<number>`count(*)` })
          .from(signals)
          .where(and(eq(signals.thoughtId, signal.thoughtId), sql`${signals.id} != ${id}`))
          .get()?.count ?? 0;

      if (siblings === 0) {
        db.update(thoughts)
          .set({ state: "closed", updatedAt: new Date().toISOString() })
          .where(eq(thoughts.id, signal.thoughtId))
          .run();
      }
    }

    db.update(signals).set({ disposition: "new", thoughtId: null }).where(eq(signals.id, id)).run();

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

  /**
   * PUT /signals/:id/thought — link a signal to a thought. Either names an
   * existing thought id, or a title to create a new seedling thought on
   * the spot — the same two options the mockup's thought-link picker
   * offers. Distinct from reclassify: this corrects or sets which larger
   * item a signal belongs to, not which Direction matched it.
   */
  app.put("/:id/thought", zValidator("json", LinkThoughtRequestSchema), (c) => {
    const { id } = c.req.param();
    const body = c.req.valid("json");

    const signal = db.select().from(signals).where(eq(signals.id, id)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);

    let thoughtId: string;
    let created = false;

    if ("thoughtId" in body) {
      const existing = db
        .select({ id: thoughts.id })
        .from(thoughts)
        .where(eq(thoughts.id, body.thoughtId))
        .get();
      if (!existing) return c.json({ error: "Unknown thoughtId" }, 422);
      thoughtId = body.thoughtId;
    } else {
      thoughtId = newId();
      created = true;
      db.insert(thoughts)
        .values({
          id: thoughtId,
          title: body.title,
          body: signal.body,
          state: "seedling",
          directionId: signal.directionId,
        })
        .run();
    }

    const previousThoughtId = signal.thoughtId;

    db.update(signals).set({ thoughtId }).where(eq(signals.id, id)).run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "signal.thought_linked",
        payload: JSON.stringify({
          signalId: id,
          thoughtId,
          previousThoughtId,
          createdThought: created,
        }),
      })
      .run();

    return c.json({ ok: true, thoughtId, created });
  });

  /**
   * DELETE /signals/:id/thought — unlink without touching the thought
   * itself (it may still have other signals attached, or be worth keeping
   * on its own). The reverse of PUT above.
   */
  app.delete("/:id/thought", (c) => {
    const { id } = c.req.param();
    const signal = db.select().from(signals).where(eq(signals.id, id)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);
    if (!signal.thoughtId) return c.json({ error: "Not linked to a thought" }, 409);

    const previousThoughtId = signal.thoughtId;

    db.update(signals).set({ thoughtId: null }).where(eq(signals.id, id)).run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "signal.thought_unlinked",
        payload: JSON.stringify({ signalId: id, previousThoughtId }),
      })
      .run();

    return c.json({ ok: true, previousThoughtId });
  });

  /**
   * PUT /signals/:id/reviewed — mark a signal reviewed: "I've seen this,
   * nothing more to do," for signals that never had an action to approve
   * or discard in the first place (information/acknowledgement signals,
   * or anything filed/promoted without a draft). DELETE clears it.
   */
  app.put("/:id/reviewed", (c) => {
    const { id } = c.req.param();
    const signal = db.select().from(signals).where(eq(signals.id, id)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);

    const at = new Date().toISOString();
    db.update(signals).set({ reviewedAt: at }).where(eq(signals.id, id)).run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "signal.reviewed",
        payload: JSON.stringify({ signalId: id }),
      })
      .run();

    return c.json({ ok: true, reviewedAt: at });
  });

  /**
   * POST /signals/:id/acknowledge — "seen, nothing more to do", in one step:
   * marks the signal reviewed, closes its linked thought, and dismisses any
   * proposed reply. Dismissed (not discarded) so that acknowledging does not
   * count as rejecting the draft in the direction's override rate.
   */
  app.post("/:id/acknowledge", (c) => {
    const { id } = c.req.param();
    const signal = db.select().from(signals).where(eq(signals.id, id)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);

    const at = new Date().toISOString();
    const dismissed = db
      .select({ id: actions.id })
      .from(actions)
      .where(and(eq(actions.signalId, id), eq(actions.status, "proposed")))
      .all()
      .map((a) => a.id);

    let closedThoughtId: string | null = null;
    db.transaction((tx) => {
      tx.update(signals).set({ reviewedAt: at }).where(eq(signals.id, id)).run();

      if (signal.thoughtId) {
        const thought = tx.select().from(thoughts).where(eq(thoughts.id, signal.thoughtId)).get();
        if (thought && thought.state !== "closed") {
          tx.update(thoughts)
            .set({ state: "closed", updatedAt: at })
            .where(eq(thoughts.id, thought.id))
            .run();
          closedThoughtId = thought.id;
        }
      }

      for (const actionId of dismissed) {
        tx.update(actions).set({ status: "dismissed" }).where(eq(actions.id, actionId)).run();
      }

      tx.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "signal.acknowledged",
          payload: JSON.stringify({
            signalId: id,
            closedThoughtId,
            dismissedActionIds: dismissed,
          }),
        })
        .run();
    });

    return c.json({ ok: true, reviewedAt: at, closedThoughtId, dismissedActionIds: dismissed });
  });

  app.delete("/:id/reviewed", (c) => {
    const { id } = c.req.param();
    const signal = db.select().from(signals).where(eq(signals.id, id)).get();
    if (!signal) return c.json({ error: "Not found" }, 404);

    db.update(signals).set({ reviewedAt: null }).where(eq(signals.id, id)).run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "signal.review_cleared",
        payload: JSON.stringify({ signalId: id }),
      })
      .run();

    return c.json({ ok: true });
  });

  return app;
}

/** Re-validates the stored JSON so a bad row can never reach the extension as an action. */
function parseSignalActions(json: string | null): SignalAction[] {
  if (!json) return [];
  try {
    const parsed = z.array(SignalActionSchema).safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
