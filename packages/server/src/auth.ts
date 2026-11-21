/**
 * Bearer token middleware.
 *
 * Two kinds of credential are accepted:
 *
 *   master  the operator's own token from ~/.config/kIiYOSJe/mind/token,
 *           mode 600 and generated on first start. Full access.
 *   device  a token issued by pairing (POST /devices/pair), stored only as a
 *           SHA-256 hash in the `devices` table. Every request is looked up
 *           afresh, so revoking a device in the editor locks it out on its next
 *           call with no server restart.
 *
 * A device token is checked against its scopes per request (see
 * `deviceAccess` in @mind/core). Unknown routes are denied, so opening a new
 * scoped route is a deliberate edit rather than a default.
 *
 * `POST /devices/pair` is the only route that skips this middleware: the new
 * device has no credential yet and presents the one-time pairing code instead.
 * The route itself is rate-limited and code attempts are capped.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Db } from "@mind/core";
import {
  deviceAccess,
  devices,
  ensureDirs,
  hashSecret,
  logger,
  parseScopes,
  secretEquals,
  tokenPath,
} from "@mind/core";
import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

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

/** Tests may pin the token with MIND_TEST_TOKEN instead of reading the file. */
function currentToken(): string {
  return process.env["MIND_TEST_TOKEN"] ?? TOKEN;
}

/** A device may complete its own pairing without a token; nothing else may. */
function isPairingRequest(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && path === "/devices/pair";
}

export function bearerAuth(db: Db) {
  return createMiddleware(async (c, next) => {
    if (isPairingRequest(c.req.method, c.req.path)) {
      await next();
      return;
    }

    const header = c.req.header("Authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";

    if (given === "" || !secretEquals(given, currentToken())) {
      // Not the master token — try the device registry. Looking the hash up
      // keeps every issued token out of memory and out of logs.
      const device = given
        ? db
            .select()
            .from(devices)
            .where(and(eq(devices.tokenHash, hashSecret(given)), isNull(devices.revokedAt)))
            .get()
        : undefined;

      if (!device) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const access = deviceAccess(c.req.method, c.req.path);
      if (access.kind === "master") {
        return c.json({ error: "Only the operator's own token may manage devices" }, 403);
      }
      if (access.kind === "deny") {
        return c.json({ error: access.reason }, 403);
      }
      if (!parseScopes(device.scopes).includes(access.scope)) {
        return c.json(
          { error: `device '${device.name}' does not have the '${access.scope}' permission` },
          403,
        );
      }

      db.update(devices)
        .set({ lastSeenAt: new Date().toISOString() })
        .where(eq(devices.id, device.id))
        .run();
      await next();
      return;
    }

    await next();
  });
}

/** Exported for the CLI to print on first run. */
export function getToken(): string {
  return currentToken();
}
