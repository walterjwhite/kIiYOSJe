/**
 * Bearer token middleware.
 * Token is read from ~/.config/kIiYOSJe/mind/token (600 permissions).
 * If the file does not exist, a token is generated and written on first start.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createMiddleware } from "hono/factory";
import { tokenPath, ensureDirs } from "@mind/core";
import { logger } from "@mind/core";

function loadOrCreateToken(): string {
  ensureDirs();
  const path = tokenPath();
  if (existsSync(path)) {
    return readFileSync(path, "utf8").trim();
  }
  const token = crypto.randomUUID() + "-" + crypto.randomUUID();
  writeFileSync(path, token, { mode: 0o600 });
  logger.info({ tokenPath: path }, "Generated new API token");
  return token;
}

const TOKEN = loadOrCreateToken();

export const bearerAuth = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (given !== TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** Exported for the CLI to print on first run. */
export function getToken(): string {
  return TOKEN;
}
