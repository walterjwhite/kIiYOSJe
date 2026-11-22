/**
 * Admin routes — pause/resume kill switch, status read, AI provider config,
 * notification quiet period, and display settings.
 *
 * POST /admin/pause       → activates the paused flag file
 * POST /admin/resume      → removes the paused flag file
 * GET  /admin/status      → returns the last-written status payload (503 if absent)
 * GET  /admin/ai-config   → returns the current effective AI config (key masked)
 * PUT  /admin/ai-config   → writes ~/.config/kIiYOSJe/mind/ai.json; takes effect on the next signal,
 *                           no server restart required
 * POST /admin/shutdown    → stops the server process (SIGTERM shortly after replying);
 *                           how the extension's Stop/Restart reaches a server it did not start
 * GET  /admin/display     → which signal fields/attributes the extension shows by default
 * PUT  /admin/display     → writes ~/.config/kIiYOSJe/mind/display.json
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
  contextTokens,
  loadApiKey,
  quietPeriodConfig,
  writeQuietPeriodConfig,
  isWithinNotificationWindow,
  QuietPeriodConfigSchema,
  displaySettings,
  writeDisplaySettings,
  DisplaySettingsSchema,
  autolinkSettings,
  writeAutolinkSettings,
  AutolinkSettingsSchema,
  audioSettings,
  learningSettings,
  writeLearningSettings,
  LearningSettingsSchema,
  writeAudioSettings,
  AudioSettingsSchema,
} from "@mind/core";

const AiConfigRequestSchema = z.object({
  provider: z.enum([
    "ollama",
    "openai",
    "anthropic",
    "google",
    "openai-compatible",
    "copilot",
    "kiro",
    "copilot-cli",
  ]),
  classifyModel: z.string().min(1).optional(),
  draftModel: z.string().min(1).optional(),
  baseURL: z.string().url().optional(),
  apiKey: z.string().optional(),
  /** The model's context window; omit to leave the current value alone. */
  contextTokens: z.number().int().min(1024).max(2_000_000).optional(),
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

  app.post("/shutdown", (c) => {
    // Reply first, then terminate; the delay lets the response flush.
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 100).unref();
    return c.json({ ok: true, stopping: true });
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
      contextTokens: contextTokens(),
    });
  });

  // PUT /admin/ai-config — overwrite the config file
  app.put("/ai-config", zValidator("json", AiConfigRequestSchema), (c) => {
    const body = c.req.valid("json");
    writeAiConfig(body);
    return c.json({ ok: true });
  });

  // GET /admin/notifications — the current quiet-period window, plus
  // whether a notification sent right now would be allowed through.
  app.get("/notifications", (c) => {
    const config = quietPeriodConfig();
    return c.json({ ...config, allowedNow: isWithinNotificationWindow(new Date(), config) });
  });

  // PUT /admin/notifications — overwrite the quiet-period window.
  // This only gates proactive notifications (e.g. "your brief is ready");
  // it never affects asking for something right now, and never affects
  // ingestion, matching, or drafting.
  app.put("/notifications", zValidator("json", QuietPeriodConfigSchema), (c) => {
    const body = c.req.valid("json");
    writeQuietPeriodConfig(body);
    return c.json({ ok: true });
  });

  // GET /admin/display — which signal fields/attributes the extension shows
  // by default (subject, Cc, Bcc, preferring the HTML body when present).
  app.get("/display", (c) => {
    return c.json(displaySettings());
  });

  // PUT /admin/display — overwrite the display settings.
  app.put("/display", zValidator("json", DisplaySettingsSchema), (c) => {
    const body = c.req.valid("json");
    writeDisplaySettings(body);
    return c.json({ ok: true });
  });

  // GET/PUT /admin/autolink — whether new signals are linked to Goals
  // automatically, and how confident the model must be first.
  // GET/PUT /admin/audio — the voice, speed and tone of the spoken summary, and
  // how Piper is run. The voice name is validated against a strict pattern
  // because it decides which file is downloaded.
  app.get("/audio", (c) => c.json(audioSettings()));
  app.put("/audio", zValidator("json", AudioSettingsSchema), (c) => {
    writeAudioSettings(c.req.valid("json"));
    return c.json({ ok: true });
  });

  app.get("/autolink", (c) => c.json(autolinkSettings()));
  app.put("/autolink", zValidator("json", AutolinkSettingsSchema), (c) => {
    writeAutolinkSettings(c.req.valid("json"));
    return c.json({ ok: true });
  });

  // GET/PUT /admin/learning — the nightly window in which the learning loop
  // runs on its own (local time, 24-hour HH:MM; default 00:00 to 04:00).
  app.get("/learning", (c) => c.json(learningSettings()));
  app.put("/learning", zValidator("json", LearningSettingsSchema), (c) => {
    writeLearningSettings(c.req.valid("json"));
    return c.json({ ok: true });
  });

  return app;
}
