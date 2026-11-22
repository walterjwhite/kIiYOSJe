/**
 * Builds and returns the Hono application.
 * Separated from the HTTP listener so it can be tested without binding a port.
 */

import type { Db } from "@mind/core";
import type { AdapterRegistry } from "@mind/pipeline";
import { Hono } from "hono";
import { bearerAuth } from "./auth.js";
import { bodyLimit, errorResponse } from "./errors.js";
import { actionsRouter } from "./routes/actions.js";
import { adminRouter } from "./routes/admin.js";
import { briefRouter } from "./routes/brief.js";
import { devicesRouter } from "./routes/devices.js";
import { directionsRouter } from "./routes/directions.js";
import { eventsRouter } from "./routes/events.js";
import { healthRouter } from "./routes/health.js";
import { metricsRouter } from "./routes/metrics.js";
import { learningsRouter } from "./routes/learnings.js";
import { proposalsRouter } from "./routes/proposals.js";
import { queueRouter } from "./routes/queue.js";
import { signalsRouter } from "./routes/signals-ingress.js";
import { summaryRouter } from "./routes/summary.js";
import { thoughtsRouter } from "./routes/thoughts.js";

export function buildApp(db: Db, adapters: AdapterRegistry) {
  const app = new Hono();

  // All routes require a valid bearer token: the operator's master token, or a
  // paired device's token checked against its scopes. POST /devices/pair is the
  // single exception and authenticates with a one-time code instead.
  app.use("/*", bearerAuth(db));
  app.use("/*", bodyLimit);
  app.onError(errorResponse);

  app.route("/health", healthRouter(adapters, db));
  app.route("/brief", briefRouter(db));
  app.route("/thoughts", thoughtsRouter(db));
  app.route("/directions", directionsRouter(db));
  app.route("/actions", actionsRouter(db, adapters));
  app.route("/signals", signalsRouter(db, adapters));
  app.route("/metrics", metricsRouter(db));
  app.route("/admin", adminRouter());
  app.route("/proposals", proposalsRouter(db));
  app.route("/learnings", learningsRouter());
  app.route("/events", eventsRouter(db));
  app.route("/queue", queueRouter(db));
  app.route("/summary", summaryRouter(db));
  app.route("/devices", devicesRouter(db));

  return app;
}
