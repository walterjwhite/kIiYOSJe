/**
 * Builds and returns the Hono application.
 * Separated from the HTTP listener so it can be tested without binding a port.
 */

import { Hono } from "hono";
import type { Db } from "@mind/core";
import type { AdapterRegistry } from "@mind/pipeline";
import { bearerAuth } from "./auth.js";
import { healthRouter } from "./routes/health.js";
import { thoughtsRouter } from "./routes/thoughts.js";
import { directionsRouter } from "./routes/directions.js";
import { actionsRouter } from "./routes/actions.js";
import { metricsRouter } from "./routes/metrics.js";
import { briefRouter } from "./routes/brief.js";
import { signalsRouter } from "./routes/signals-ingress.js";
import { adminRouter } from "./routes/admin.js";
import { proposalsRouter } from "./routes/proposals.js";

export function buildApp(db: Db, adapters: AdapterRegistry) {
  const app = new Hono();

  // All routes require a valid bearer token.
  app.use("/*", bearerAuth);

  app.route("/health", healthRouter(adapters));
  app.route("/brief", briefRouter(db));
  app.route("/thoughts", thoughtsRouter(db));
  app.route("/directions", directionsRouter(db));
  app.route("/actions", actionsRouter(db, adapters));
  app.route("/signals", signalsRouter(db, adapters));
  app.route("/metrics", metricsRouter(db));
  app.route("/admin", adminRouter());
  app.route("/proposals", proposalsRouter(db));

  return app;
}
