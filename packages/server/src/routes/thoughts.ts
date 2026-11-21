import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import {
  thoughts,
  events,
  newId,
  CreateThoughtRequestSchema,
  UpdateThoughtRequestSchema,
  ThoughtStateSchema,
} from "@mind/core";
import type { Db } from "@mind/core";

export function thoughtsRouter(db: Db) {
  const app = new Hono();

  // GET /thoughts?state=
  app.get("/", (c) => {
    const state = c.req.query("state");
    let rows;
    if (state) {
      ThoughtStateSchema.parse(state);
      rows = db
        .select()
        .from(thoughts)
        .where(eq(thoughts.state, state))
        .all();
    } else {
      rows = db.select().from(thoughts).all();
    }
    return c.json(rows);
  });

  // POST /thoughts
  app.post("/", zValidator("json", CreateThoughtRequestSchema), (c) => {
    const body = c.req.valid("json");
    const id = newId();
    db.insert(thoughts)
      .values({
        id,
        title: body.title,
        body: body.body,
        directionId: body.directionId,
        state: body.state ?? "seedling",
      })
      .run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "thought.created",
        payload: JSON.stringify({ thoughtId: id, state: body.state ?? "seedling" }),
      })
      .run();

    return c.json({ id }, 201);
  });

  // PATCH /thoughts/:id
  app.patch("/:id", zValidator("json", UpdateThoughtRequestSchema), (c) => {
    const { id } = c.req.param();
    const body = c.req.valid("json");
    const now = new Date().toISOString();

    const existing = db
      .select()
      .from(thoughts)
      .where(eq(thoughts.id, id))
      .get();

    if (!existing) return c.json({ error: "Not found" }, 404);

    db.update(thoughts)
      .set({
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.nextAction !== undefined
          ? { nextAction: body.nextAction }
          : {}),
        ...(body.reviewAt !== undefined ? { reviewAt: body.reviewAt } : {}),
        updatedAt: now,
      })
      .where(eq(thoughts.id, id))
      .run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "thought.updated",
        payload: JSON.stringify({ thoughtId: id, changes: body }),
      })
      .run();

    return c.json({ ok: true });
  });

  return app;
}
