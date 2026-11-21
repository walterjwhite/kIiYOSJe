/**
 * Server entry point. Called by the CLI's `mind start` command.
 */

import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { registerDefaultAdapters } from "@mind/adapters";
import { logger, openDb, SERVER_HOST, SERVER_PORT, serverBindHost } from "@mind/core";
import {
  AdapterRegistry,
  ensureFallbackDirection,
  ingest,
  loadDirections,
  startBackupJob,
  startEscalationChecker,
  startLearningLoop,
  startRetentionJob,
  startStatusWriter,
  updateStatus,
} from "@mind/pipeline";
import { buildApp } from "./app.js";
import { directionsRoot } from "./directions-dir.js";

export async function startServer(): Promise<void> {
  const db = openDb();

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
  registerDefaultAdapters(adapters);

  for (const adapter of adapters.all()) {
    await adapter.start((signal) => {
      ingest(db, signal, adapters)
        .then(() => updateStatus(db, adapters))
        .catch((err) => logger.error({ err }, "Pipeline error"));
    });
  }

  startEscalationChecker(db);
  startRetentionJob(db);
  startBackupJob();
  startStatusWriter(db, adapters);
  startLearningLoop(db);

  const app = buildApp(db, adapters);
  const host = serverBindHost();
  if (host !== SERVER_HOST) {
    logger.warn(
      { host },
      "mind server is bound beyond loopback; every route still requires a token, but keep the port off untrusted networks",
    );
  }

  serve(
    {
      fetch: app.fetch,
      hostname: host,
      port: SERVER_PORT,
    },
    () => {
      logger.info({ host, port: SERVER_PORT }, "mind server started");
      logger.debug({ tokenPath: "~/.config/kIiYOSJe/mind/token" }, "API token location");
      // Write initial status immediately.
      updateStatus(db, adapters);
    },
  );
}
