import type { Db } from "@mind/core";
import type { AdapterRegistry } from "@mind/pipeline";
import { deferredCount, resilienceState } from "@mind/pipeline";
import { Hono } from "hono";

export function healthRouter(adapters: AdapterRegistry, db: Db) {
  const app = new Hono();

  app.get("/", (c) => {
    const adapterStatus = adapters.all().map((a) => ({
      id: a.id,
      account: a.account,
      canSend: a.capabilities.canSend,
      canStream: a.capabilities.canStream,
    }));

    return c.json({
      ok: true,
      uptime: process.uptime(),
      adapters: adapterStatus,
      // Whether model calls are flowing (`closed`), paused after repeated failures
      // (`open`), or being probed (`half-open`), how many are running or waiting,
      // and how many signals are held until the model answers.
      model: { ...resilienceState(), deferred: deferredCount(db) },
    });
  });

  return app;
}
