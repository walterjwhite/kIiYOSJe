import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { directions, events, newId } from "@mind/core";
import type { Db } from "@mind/core";

const UpdateDirectionSchema = z.object({
  enabled: z.boolean().optional(),
  autonomy: z.enum(["observe", "draft", "send"]).optional(),
  confidenceMin: z.number().min(0).max(1).optional(),
});

export function directionsRouter(db: Db) {
  const app = new Hono();

  // GET /directions — all directions with signal counts
  app.get("/", (c) => {
    const rows = db.select().from(directions).all();
    return c.json(rows);
  });

  // PUT /directions/:id — update guarded fields only
  app.put(
    "/:id",
    zValidator("json", UpdateDirectionSchema),
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
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.autonomy !== undefined ? { autonomy: body.autonomy } : {}),
          ...(body.confidenceMin !== undefined
            ? { confidenceMin: body.confidenceMin }
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
