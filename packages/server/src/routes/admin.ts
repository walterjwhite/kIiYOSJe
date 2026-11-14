/**
 * Admin routes — pause/resume kill switch and status read.
 *
 * POST /admin/pause  → activates the paused flag file
 * POST /admin/resume → removes the paused flag file
 * GET  /admin/status → returns the last-written status payload (503 if absent)
 */

import { Hono } from "hono";
import { pause, resume, readStatus } from "@mind/core";

export function adminRouter() {
  const app = new Hono();

  app.post("/pause", (c) => {
    pause();
    return c.json({ ok: true, paused: true });
  });

  app.post("/resume", (c) => {
    resume();
    return c.json({ ok: true, paused: false });
  });

  app.get("/status", (c) => {
    const status = readStatus();
    if (!status) {
      return c.json({ error: "status not available" }, 503);
    }
    return c.json(status);
  });

  return app;
}
