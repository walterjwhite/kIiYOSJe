/**
 * Server entry point. Called by the CLI's `mind start` command.
 */

import { serve } from "@hono/node-server";
import { openDb, SERVER_HOST, SERVER_PORT, logger } from "@mind/core";
import {
  AdapterRegistry,
  loadDirections,
  ensureFallbackDirection,
  startEscalationChecker,
  ingest,
} from "@mind/pipeline";
import { TeamsAdapter } from "@mind/adapters-teams";
import { EmailAdapter } from "@mind/adapters-email";
import { buildApp } from "./app.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

function directionsRoot(): string {
  // packages/server/dist/index.js → walk up to workspace root → directions/
  return join(import.meta.dirname, "..", "..", "..", "directions");
}

export async function startServer(): Promise<void> {
  const db = openDb();

  // Ensure the catch-all direction exists before loading YAML, so explicit
  // directions always take precedence.
  ensureFallbackDirection(db);

  const dRoot = directionsRoot();
  if (existsSync(dRoot)) {
    loadDirections(db, dRoot);
  } else {
    logger.warn({ path: dRoot }, "directions directory not found, skipping load");
  }

  process.on("SIGHUP", () => {
    logger.info("SIGHUP: reloading directions");
    loadDirections(db, dRoot);
  });

  const adapters = new AdapterRegistry();
  adapters.register(new TeamsAdapter());
  adapters.register(new EmailAdapter());

  for (const adapter of adapters.all()) {
    await adapter.start((signal) => {
      ingest(db, signal, adapters).catch((err) =>
        logger.error({ err }, "Pipeline error"),
      );
    });
  }

  // Background checker: promote overdue thoughts to 'active' every 60 s.
  startEscalationChecker(db);

  const app = buildApp(db, adapters);

  serve(
    {
      fetch: app.fetch,
      hostname: SERVER_HOST,
      port: SERVER_PORT,
    },
    () => {
      logger.info({ host: SERVER_HOST, port: SERVER_PORT }, "mind server started");
      logger.debug({ tokenPath: "~/.config/mind/token" }, "API token location");
    },
  );
}
