/**
 * POST /signals — internal ingress endpoint.
 * Only reachable from localhost; guarded by bearer auth.
 * Adapters that cannot call back (e.g. a CLI pipe) can POST here instead of
 * using the in-process sink.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { ingest } from "@mind/pipeline";
import type { AdapterRegistry } from "@mind/pipeline";
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

export function signalsRouter(db: Db, adapters: AdapterRegistry) {
  const app = new Hono();

  app.post("/", zValidator("json", NewSignalSchema), async (c) => {
    const raw = c.req.valid("json");
    const signal: NewSignal = {
      ...raw,
      receivedAt: new Date(raw.receivedAt),
    };

    const disposition = await ingest(db, signal, adapters);
    return c.json({ disposition }, disposition === "duplicate" ? 200 : 201);
  });

  return app;
}
