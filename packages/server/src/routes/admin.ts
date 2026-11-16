/**
 * Admin routes — pause/resume kill switch, status read, and AI provider config.
 *
 * POST /admin/pause       → activates the paused flag file
 * POST /admin/resume      → removes the paused flag file
 * GET  /admin/status      → returns the last-written status payload (503 if absent)
 * GET  /admin/ai-config   → returns the current effective AI config (key masked)
 * PUT  /admin/ai-config   → writes ~/.config/mind/ai.json; takes effect on the next signal,
 *                           no server restart required
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  pause,
  resume,
  readStatus,
  writeAiConfig,
  aiProvider,
  classifyModel,
  draftModel,
  aiBaseUrl,
  loadApiKey,
} from "@mind/core";

const AiConfigRequestSchema = z.object({
  provider: z.enum(["ollama", "openai", "anthropic", "google"]),
  classifyModel: z.string().min(1).optional(),
  draftModel: z.string().min(1).optional(),
  baseURL: z.string().url().optional(),
  apiKey: z.string().optional(),
});

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

  // GET /admin/ai-config — current effective config, key presence only (never the value)
  app.get("/ai-config", (c) => {
    return c.json({
      provider: aiProvider(),
      classifyModel: classifyModel(),
      draftModel: draftModel(),
      baseURL: aiBaseUrl(),
      apiKeyConfigured: loadApiKey() !== undefined,
    });
  });

  // PUT /admin/ai-config — overwrite the config file
  app.put("/ai-config", zValidator("json", AiConfigRequestSchema), (c) => {
    const body = c.req.valid("json");
    writeAiConfig(body);
    return c.json({ ok: true });
  });

  return app;
}
