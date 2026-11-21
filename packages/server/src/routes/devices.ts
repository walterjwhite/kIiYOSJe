/**
 * /devices — paired clients, and pairing a new one.
 *
 * POST /devices/pairing   start pairing from the editor: name, kind and scopes
 *                         chosen there; returns a short-lived six-digit code
 * POST /devices/pair      the new device exchanges that code for its own token
 *                         (the only unauthenticated route in the app)
 * GET  /devices           list paired devices (never their token or hash)
 * DELETE /devices/:id     revoke one device; effective on its next request
 * PATCH /devices/:id      rename a device and/or change its permissions
 * DELETE /devices/pairing/:id  withdraw a pending pairing code
 *
 * The token is returned exactly once, by POST /devices/pair, and only its
 * SHA-256 hash is stored. The pairing code is likewise stored hashed. Both are
 * audited as events; neither the code nor the token ever reaches the log.
 */

import { zValidator } from "@hono/zod-validator";
import type { Db, DeviceScope } from "@mind/core";
import {
  DeviceScopeSchema,
  devices,
  events,
  generateDeviceToken,
  generatePairingCode,
  hashSecret,
  logger,
  MAX_PAIRING_ATTEMPTS,
  newId,
  normalizeScopes,
  pairingCodeIsUsable,
  pairingCodes,
  pairingExpiresAt,
  parseScopes,
} from "@mind/core";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

const StartPairingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["android", "editor", "other"]).default("android"),
  scopes: z.array(DeviceScopeSchema).min(1),
});

const UpdateDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    scopes: z.array(DeviceScopeSchema).min(1).optional(),
  })
  .refine((v) => v.name !== undefined || v.scopes !== undefined, {
    message: "give a name or permissions to change",
  });

const CompletePairingSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "expected the six-digit code"),
  /** Optional: the phone may report its own model instead of the editor's label. */
  name: z.string().trim().min(1).max(80).optional(),
});

/**
 * Pairing tries are rate-limited in-process (the server is one process and is
 * not hosted), so guessing codes over the LAN cannot be parallelized into a
 * million requests. The bucket is global on purpose: the server may be reached
 * from several interfaces and the threat is the same from any of them.
 */
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 10;
let failures: number[] = [];

function pairingTriesAllowed(now: Date): boolean {
  failures = failures.filter((at) => now.getTime() - at < FAILURE_WINDOW_MS);
  return failures.length < MAX_FAILURES_PER_WINDOW;
}

function recordPairingFailure(now: Date): void {
  failures.push(now.getTime());
}

interface PublicDevice {
  id: string;
  name: string;
  kind: string;
  scopes: DeviceScope[];
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

function publicDevice(row: typeof devices.$inferSelect): PublicDevice {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    scopes: parseScopes(row.scopes),
    pairedAt: row.pairedAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}

export function devicesRouter(db: Db) {
  const app = new Hono();

  // Start pairing. Reached only with the operator's own token (the auth
  // middleware refuses device tokens on /devices*).
  app.post("/pairing", zValidator("json", StartPairingSchema), (c) => {
    const body = c.req.valid("json");
    const now = new Date();
    const scopes = normalizeScopes(body.scopes);
    if (scopes.length === 0) {
      return c.json({ error: "pick at least one permission" }, 400);
    }

    // Expired rows have no further use; keep the table from growing forever.
    db.delete(pairingCodes).where(lt(pairingCodes.expiresAt, now.toISOString())).run();

    const code = generatePairingCode();
    const expiresAt = pairingExpiresAt(now);
    const pairingId = newId();
    db.insert(pairingCodes)
      .values({
        id: pairingId,
        codeHash: hashSecret(code),
        name: body.name,
        kind: body.kind,
        scopes: JSON.stringify(scopes),
        createdAt: now.toISOString(),
        expiresAt,
        attempts: 0,
      })
      .run();

    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "device.pairing_started",
        payload: JSON.stringify({ pairingId, name: body.name, kind: body.kind, scopes }),
      })
      .run();

    return c.json({ pairingId, code, expiresAt, name: body.name, kind: body.kind, scopes }, 201);
  });

  // Complete pairing. Unauthenticated by design — the code is the credential.
  app.post("/pair", zValidator("json", CompletePairingSchema), (c) => {
    const { code, name } = c.req.valid("json");
    const now = new Date();

    if (!pairingTriesAllowed(now)) {
      return c.json({ error: "Too many pairing attempts. Wait a minute and try again." }, 429);
    }

    const candidates = db
      .select()
      .from(pairingCodes)
      .where(and(eq(pairingCodes.codeHash, hashSecret(code)), isNull(pairingCodes.usedAt)))
      .orderBy(desc(pairingCodes.createdAt))
      .all();
    const row = candidates.find((candidate) => pairingCodeIsUsable(candidate, now));

    if (!row) {
      // Count the miss against the newest matching row so a code dies after
      // MAX_PAIRING_ATTEMPTS wrong guesses even within its ten minutes.
      const newest = candidates[0];
      if (newest) {
        db.update(pairingCodes)
          .set({ attempts: Math.min(newest.attempts + 1, MAX_PAIRING_ATTEMPTS) })
          .where(eq(pairingCodes.id, newest.id))
          .run();
      }
      recordPairingFailure(now);
      logger.info({ pairingAttempts: candidates.length }, "device pairing rejected");
      return c.json(
        { error: "That code is not valid, has expired, or has already been used." },
        400,
      );
    }

    const token = generateDeviceToken();
    const deviceId = newId();
    const deviceName = name ?? row.name;
    db.transaction((tx) => {
      tx.update(pairingCodes)
        .set({ usedAt: now.toISOString() })
        .where(eq(pairingCodes.id, row.id))
        .run();
      tx.insert(devices)
        .values({
          id: deviceId,
          name: deviceName,
          kind: row.kind,
          tokenHash: hashSecret(token),
          scopes: row.scopes,
          pairedAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
        })
        .run();
      tx.insert(events)
        .values({
          id: newId(),
          actor: "user",
          kind: "device.paired",
          payload: JSON.stringify({
            deviceId,
            name: deviceName,
            kind: row.kind,
            scopes: parseScopes(row.scopes),
          }),
        })
        .run();
    });

    // The plaintext token leaves the process exactly here, once.
    return c.json(
      {
        deviceId,
        name: deviceName,
        kind: row.kind,
        scopes: parseScopes(row.scopes),
        token,
        pairedAt: now.toISOString(),
      },
      201,
    );
  });

  app.get("/", (c) => {
    const rows = db.select().from(devices).orderBy(desc(devices.pairedAt)).all();
    return c.json(rows.map(publicDevice));
  });

  // PATCH /devices/:id — change the name and/or permissions. The token does not
  // change, and auth reads the stored scopes on every request, so a permission
  // change applies to the device's next request.
  app.patch("/:id", zValidator("json", UpdateDeviceSchema), (c) => {
    const { id } = c.req.param();
    const body = c.req.valid("json");
    const existing = db.select().from(devices).where(eq(devices.id, id)).get();
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (existing.revokedAt) return c.json({ error: "device is revoked" }, 409);

    const scopes = body.scopes ? normalizeScopes(body.scopes) : undefined;
    db.update(devices)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(scopes ? { scopes: JSON.stringify(scopes) } : {}),
      })
      .where(eq(devices.id, id))
      .run();
    // Names are operator-chosen text, so the audit row records only what kind of change it was.
    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: scopes ? "device.scopes_changed" : "device.renamed",
        payload: JSON.stringify({ deviceId: id, ...(scopes ? { scopes } : {}) }),
      })
      .run();
    return c.json({ ok: true, ...(body.name !== undefined ? { name: body.name } : {}), scopes });
  });

  // DELETE /devices/pairing/:id — withdraw a pending code, so a code issued with
  // wider permissions than the operator then chose cannot linger until it expires.
  app.delete("/pairing/:id", (c) => {
    db.delete(pairingCodes)
      .where(eq(pairingCodes.id, c.req.param("id")))
      .run();
    return c.json({ ok: true });
  });

  app.delete("/:id", (c) => {
    const { id } = c.req.param();
    const existing = db.select().from(devices).where(eq(devices.id, id)).get();
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (existing.revokedAt) return c.json({ ok: true, alreadyRevoked: true });

    const revokedAt = new Date().toISOString();
    db.update(devices).set({ revokedAt }).where(eq(devices.id, id)).run();
    db.insert(events)
      .values({
        id: newId(),
        actor: "user",
        kind: "device.revoked",
        payload: JSON.stringify({ deviceId: id, name: existing.name }),
      })
      .run();

    return c.json({ ok: true, revokedAt });
  });

  return app;
}
