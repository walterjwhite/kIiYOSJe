import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { actions, events, signals, newId, globalSendEnabled } from "@mind/core";
import type { Db } from "@mind/core";
import type { AdapterRegistry } from "@mind/pipeline";
import type { OutboundDraft } from "@mind/core";

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

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "action.sent",
        payload: JSON.stringify({ actionId: id, externalId: result.externalId }),
      })
      .run();

    return c.json({ ok: true, externalId: result.externalId });
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

    return c.json({ ok: true });
  });

  return app;
}
