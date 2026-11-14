/**
 * Server entry point. Called by the CLI's `mind start` command.
 */

import { serve } from "@hono/node-server";
import { openDb, SERVER_HOST, SERVER_PORT, logger } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import { TeamsAdapter } from "@mind/adapters-teams";
import { EmailAdapter } from "@mind/adapters-email";
import { buildApp } from "./app.js";
import { getToken } from "./auth.js";

export async function startServer(): Promise<void> {
  const db = openDb();

  const adapters = new AdapterRegistry();
  adapters.register(new TeamsAdapter());
  adapters.register(new EmailAdapter());

  // Provide the in-process sink to each adapter.
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
      logger.info(
        { host: SERVER_HOST, port: SERVER_PORT },
        "mind server started",
      );
      // Print token only on first start (token file just created).
      logger.debug({ tokenPath: "~/.config/mind/token" }, "API token location");
    },
  );
}
