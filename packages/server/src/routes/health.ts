import { Hono } from "hono";
import type { AdapterRegistry } from "@mind/pipeline";

export function healthRouter(adapters: AdapterRegistry) {
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
    });
  });

  return app;
}
