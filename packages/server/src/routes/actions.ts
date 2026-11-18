import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  actions,
  directions,
  events,
  signals,
  newId,
  isPaused,
  logger,
} from "@mind/core";
import type { Db } from "@mind/core";
import { markThreadAwaitingReply } from "@mind/pipeline";
import type { AdapterRegistry } from "@mind/pipeline";
import type { OutboundDraft } from "@mind/core";

const PatchActionSchema = z.object({
  body: z.string().min(1),
});

export function actionsRouter(db: Db, adapters: AdapterRegistry) {
  const app = new Hono();

  // GET /actions?status=
  app.get("/", (c) => {
    const status = c.req.query("status");
    let rows;
    if (status) {
      rows = db
        .select()
        .from(actions)
        .where(eq(actions.status, status))
        .all();
    } else {
      rows = db.select().from(actions).all();
    }
    return c.json(rows);
  });

  // POST /actions/:id/send — human approval
  app.post("/:id/send", async (c) => {
    const { id } = c.req.param();
    const action = db
      .select()
      .from(actions)
      .where(eq(actions.id, id))
      .get();

    if (!action) return c.json({ error: "Not found" }, 404);
    if (action.status !== "proposed")
      return c.json({ error: "Action is not in proposed state" }, 409);

    // Kill switch blocks every send, including human-approved ones.
    if (isPaused()) {
      return c.json({ error: "Sends are paused. Run `mind resume` first." }, 423);
    }

    const adapter = adapters.get(action.adapter);
    if (!adapter?.send) {
      return c.json(
        { error: `Adapter '${action.adapter}' cannot send` },
        422,
      );
    }

    let draft: OutboundDraft;
    try {
      draft = JSON.parse(action.payload) as OutboundDraft;
    } catch {
      return c.json({ error: "Malformed action payload" }, 500);
    }

    const now = new Date().toISOString();
    let result;
    try {
      result = await adapter.send(draft);
    } catch (err) {
      db.update(actions)
        .set({ status: "failed" })
        .where(eq(actions.id, id))
        .run();
      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "action.failed",
          payload: JSON.stringify({ actionId: id, error: String(err) }),
        })
        .run();
      return c.json({ error: "Send failed" }, 502);
    }

    db.update(actions)
      .set({ status: "sent", sentAt: now })
      .where(eq(actions.id, id))
      .run();

    // Two-sided tracking: a send only counts as absorption once the other side
    // answers. Without this, "absorbed" hides a thread that went quiet.
    let awaitingReply = false;
    if (action.signalId) {
      const sentSignal = db
        .select({ threadId: signals.threadId })
        .from(signals)
        .where(eq(signals.id, action.signalId))
        .get();
      if (sentSignal?.threadId) {
        markThreadAwaitingReply(db, sentSignal.threadId, now, action.thoughtId);
        awaitingReply = true;
      }
    }

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "action.sent",
        payload: JSON.stringify({
          actionId: id,
          externalId: result.externalId,
          awaitingReply,
        }),
      })
      .run();

    return c.json({ ok: true, externalId: result.externalId, awaitingReply });
  });

  // POST /actions/:id/discard
  app.post("/:id/discard", (c) => {
    const { id } = c.req.param();
    const action = db
      .select()
      .from(actions)
      .where(eq(actions.id, id))
      .get();

    if (!action) return c.json({ error: "Not found" }, 404);
    if (action.status !== "proposed")
      return c.json({ error: "Action is not in proposed state" }, 409);

    db.update(actions)
      .set({ status: "discarded" })
      .where(eq(actions.id, id))
      .run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "action.discarded",
        payload: JSON.stringify({ actionId: id }),
      })
      .run();

    // ── Auto-disable direction at >20 % override rate ─────────────────────
    if (action.signalId) {
      const signal = db
        .select({ directionId: signals.directionId })
        .from(signals)
        .where(eq(signals.id, action.signalId))
        .get();

      const directionId = signal?.directionId ?? null;

      if (directionId) {
        const totalRow = db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${directionId} and ${actions.status} in ('proposed','sent','discarded')`,
          )
          .get();

        const discardedRow = db
          .select({ count: sql<number>`count(*)` })
          .from(actions)
          .innerJoin(signals, eq(actions.signalId, signals.id))
          .where(
            sql`${signals.directionId} = ${directionId} and ${actions.status} = 'discarded'`,
          )
          .get();

        const total = totalRow?.count ?? 0;
        const discarded = discardedRow?.count ?? 0;

        if (total >= 5 && discarded / total > 0.20) {
          const overrideRate = discarded / total;

          db.update(directions)
            .set({ enabled: false, updatedAt: new Date().toISOString() })
            .where(eq(directions.id, directionId))
            .run();

          db.insert(events)
            .values({
              id: newId(),
              actor: "system",
              kind: "direction.auto-disabled",
              payload: JSON.stringify({
                directionId,
                overrideRate,
                total,
                discarded,
              }),
            })
            .run();

          logger.warn(
            { directionId, overrideRate, total, discarded },
            "direction auto-disabled: override rate exceeded 20%",
          );
        }
      }
    }

    return c.json({ ok: true });
  });

  // PATCH /actions/:id — edit draft body before sending
  app.patch(
    "/:id",
    zValidator("json", PatchActionSchema),
    (c) => {
      const { id } = c.req.param();
      const { body: newBody } = c.req.valid("json");

      const action = db
        .select()
        .from(actions)
        .where(eq(actions.id, id))
        .get();

      if (!action) return c.json({ error: "Not found" }, 404);
      if (action.status !== "proposed")
        return c.json({ error: "Action is not in proposed state" }, 409);

      let draft: OutboundDraft;
      try {
        draft = JSON.parse(action.payload) as OutboundDraft;
      } catch {
        return c.json({ error: "Malformed action payload" }, 500);
      }

      draft.body = newBody;

      db.update(actions)
        .set({ payload: JSON.stringify(draft) })
        .where(eq(actions.id, id))
        .run();

      db.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "action.edited",
          payload: JSON.stringify({ actionId: id }),
        })
        .run();

      return c.json({ ok: true });
    },
  );

  return app;
}
