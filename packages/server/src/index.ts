/**
 * Server entry point. Called by the CLI's `mind start` command.
 */

import { serve } from "@hono/node-server";
import { openDb, SERVER_HOST, SERVER_PORT, logger } from "@mind/core";
import { AdapterRegistry, loadDirections } from "@mind/pipeline";
import { TeamsAdapter } from "@mind/adapters-teams";
import { EmailAdapter } from "@mind/adapters-email";
import { buildApp } from "./app.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Directions root: <project root>/directions  (two levels up from packages/server/dist)
// Resolved relative to this file at runtime.
function directionsRoot(): string {
  // In production the dist layout is packages/server/dist/index.js
  // so ../../.. walks to the workspace root.
  const candidate = join(import.meta.dirname, "..", "..", "..", "directions");
  return candidate;
}

export async function startServer(): Promise<void> {
  const db = openDb();

  // Load directions from YAML before starting adapters so the first signal
  // already has direction coverage.
  const dRoot = directionsRoot();
  if (existsSync(dRoot)) {
    loadDirections(db, dRoot);
  } else {
    logger.warn({ path: dRoot }, "directions directory not found, skipping load");
  }

  // Reload on SIGHUP without restarting.
  process.on("SIGHUP", () => {
    logger.info("SIGHUP: reloading directions");
    loadDirections(db, dRoot);
  });

  const adapters = new AdapterRegistry();
  adapters.register(new TeamsAdapter());
  adapters.register(new EmailAdapter());

  const { ingest } = await import("@mind/pipeline");
  for (const adapter of adapters.all()) {
    await adapter.start((signal) => {
      ingest(db, signal, adapters).catch((err) =>
        logger.error({ err }, "Pipeline error"),
      );
    });
  }

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
