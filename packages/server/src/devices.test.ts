/**
 * Device pairing and per-device scopes, end to end through the real app.
 * In-memory database, real migrations, the master token pinned by env.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { getToken } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

process.env["MIND_TEST_TOKEN"] = "test-token";
process.env["MIND_CONFIG_DIR"] = mkdtempSync(join(tmpdir(), "mind-devices-config-"));
process.env["MIND_DATA_DIR"] = mkdtempSync(join(tmpdir(), "mind-devices-data-"));
process.env["MIND_AI_PROVIDER"] = "openai";
process.env["MIND_DIRECTIONS_DIR"] = mkdtempSync(join(tmpdir(), "mind-devices-directions-"));
delete process.env["OPENAI_API_KEY"];
delete process.env["MIND_AI_API_KEY"];

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

type App = ReturnType<typeof buildApp>;

function masterHeaders() {
  return { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" };
}

async function startPairing(app: App, scopes: string[] = ["read", "capture"]) {
  const res = await app.request("/devices/pairing", {
    method: "POST",
    headers: masterHeaders(),
    body: JSON.stringify({ name: "My Android phone", kind: "android", scopes }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as {
    pairingId: string;
    code: string;
    expiresAt: string;
    scopes: string[];
  };
}

async function completePairing(app: App, code: string) {
  const res = await app.request("/devices/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as {
    deviceId: string;
    name: string;
    scopes: string[];
    token: string;
  };
}

describe("device pairing", () => {
  it("starts with a six-digit code and completes with a device token", async () => {
    const db = openTestDb();
    const app = buildApp(db, new AdapterRegistry());

    const pairing = await startPairing(app);
    expect(pairing.code).toMatch(/^\d{6}$/);
    expect(pairing.scopes).toEqual(["read", "capture"]);
    expect(Date.parse(pairing.expiresAt)).toBeGreaterThan(Date.now());

    const paired = await completePairing(app, pairing.code);
    expect(paired.token).toHaveLength(43);
    expect(paired.scopes).toEqual(["read", "capture"]);

    // The device row holds a hash, never the token it just returned.
    const row = db.select().from(schema.devices).get();
    expect(row?.tokenHash).not.toBe(paired.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The code is single-use.
    expect(db.select().from(schema.pairingCodes).get()?.usedAt).toBeTruthy();

    const list = await app.request("/devices", { headers: masterHeaders() });
    expect(list.status).toBe(200);
    const devices = (await list.json()) as { id: string; scopes: string[]; tokenHash?: string }[];
    expect(devices).toHaveLength(1);
    expect(devices[0]?.id).toBe(paired.deviceId);
    expect(devices[0]?.scopes).toEqual(["read", "capture"]);
    expect(devices[0]?.tokenHash).toBeUndefined();
  });

  it("lets the paired device read the queue but not write without capture", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const pairing = await startPairing(app, ["read"]);
    const device = await completePairing(app, pairing.code);
    const headers = { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" };

    const queue = await app.request("/queue", { headers });
    expect(queue.status).toBe(200);

    const capture = await app.request("/thoughts", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "From the phone", body: "", directionId: null }),
    });
    expect(capture.status).toBe(403);
    const error = (await capture.json()) as { error: string };
    expect(error.error).toContain("capture");
  });

  it("captures a thought with the capture scope, then Send is still refused", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const pairing = await startPairing(app, ["read", "capture"]);
    const device = await completePairing(app, pairing.code);
    const headers = { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" };

    const capture = await app.request("/thoughts", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "From the phone", body: "", directionId: null }),
    });
    expect(capture.status).toBe(201);

    const approve = await app.request("/actions/act-1/send", { method: "POST", headers });
    expect(approve.status).toBe(403);
    expect(((await approve.json()) as { error: string }).error).toContain("send");
  });

  it("never lets a device manage devices or post adapter ingress", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const pairing = await startPairing(app, ["read", "capture", "send", "render", "settings"]);
    const device = await completePairing(app, pairing.code);
    const headers = { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" };

    const list = await app.request("/devices", { headers });
    expect(list.status).toBe(403);

    const ingress = await app.request("/signals", {
      method: "POST",
      headers,
      body: JSON.stringify({
        adapter: "test",
        externalId: "e1",
        threadId: null,
        sender: "a@example.com",
        recipients: [],
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
      }),
    });
    expect(ingress.status).toBe(403);
  });

  it("refuses a wrong, reused, or expired code", async () => {
    const db = openTestDb();
    const app = buildApp(db, new AdapterRegistry());
    const pairing = await startPairing(app);

    const wrong = await app.request("/devices/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(wrong.status).toBe(400);

    await completePairing(app, pairing.code);
    const reused = await app.request("/devices/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(reused.status).toBe(400);

    const expired = await startPairing(app);
    db.update(schema.pairingCodes)
      .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
      .run();
    const res = await app.request("/devices/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: expired.code }),
    });
    expect(res.status).toBe(400);
  });

  it("revokes one device immediately without touching the others", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const first = await completePairing(app, (await startPairing(app)).code);
    const second = await completePairing(app, (await startPairing(app)).code);

    const revoke = await app.request(`/devices/${first.deviceId}`, {
      method: "DELETE",
      headers: masterHeaders(),
    });
    expect(revoke.status).toBe(200);

    const lockedOut = await app.request("/queue", {
      headers: { Authorization: `Bearer ${first.token}` },
    });
    expect(lockedOut.status).toBe(401);

    const stillWorks = await app.request("/queue", {
      headers: { Authorization: `Bearer ${second.token}` },
    });
    expect(stillWorks.status).toBe(200);
  });

  it("renames a device, rejects an empty name, and keeps its token working", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const device = await completePairing(app, (await startPairing(app)).code);
    const patch = (headers: Record<string, string>, name: string) =>
      app.request(`/devices/${device.deviceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name }),
      });

    expect((await patch(masterHeaders(), "  Kitchen tablet ")).status).toBe(200);
    const list = (await (await app.request("/devices", { headers: masterHeaders() })).json()) as {
      id: string;
      name: string;
    }[];
    expect(list.find((d) => d.id === device.deviceId)?.name).toBe("Kitchen tablet");

    expect((await patch(masterHeaders(), "   ")).status).toBe(400);
    const own = { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" };
    expect((await patch(own, "Hijacked")).status).toBe(403);
    const missing = await app.request("/devices/nope", {
      method: "PATCH",
      headers: masterHeaders(),
      body: JSON.stringify({ name: "x" }),
    });
    expect(missing.status).toBe(404);
    expect(
      (await app.request("/queue", { headers: { Authorization: `Bearer ${device.token}` } }))
        .status,
    ).toBe(200);
  });

  it("changes a device's permissions and applies them on its next request", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const device = await completePairing(app, (await startPairing(app, ["read"])).code);
    const own = { Authorization: `Bearer ${device.token}`, "Content-Type": "application/json" };
    const capture = () =>
      app.request("/thoughts", {
        method: "POST",
        headers: own,
        body: JSON.stringify({ title: "From the phone", body: "", directionId: null }),
      });
    const patch = (body: unknown, headers: Record<string, string> = masterHeaders()) =>
      app.request(`/devices/${device.deviceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });

    expect((await capture()).status).toBe(403);
    expect((await patch({ scopes: ["read", "capture"] })).status).toBe(200);
    expect((await capture()).status).toBe(201);

    const list = (await (await app.request("/devices", { headers: masterHeaders() })).json()) as {
      id: string;
      scopes: string[];
    }[];
    expect(list.find((d) => d.id === device.deviceId)?.scopes).toEqual(["read", "capture"]);

    expect((await patch({ scopes: [] })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ scopes: ["root"] })).status).toBe(400);
    expect((await patch({ scopes: ["read", "settings"] }, own)).status).toBe(403);
  });

  it("cancels a pending pairing code so it can no longer be used", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());
    const pairing = await startPairing(app, ["read", "settings"]);

    const cancel = await app.request(`/devices/pairing/${pairing.pairingId}`, {
      method: "DELETE",
      headers: masterHeaders(),
    });
    expect(cancel.status).toBe(200);

    const attempt = await app.request("/devices/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(attempt.status).toBeGreaterThanOrEqual(400);

    const again = await app.request(`/devices/pairing/${pairing.pairingId}`, {
      method: "DELETE",
      headers: masterHeaders(),
    });
    expect(again.status).toBe(200);
    const anon = await app.request(`/devices/pairing/${pairing.pairingId}`, { method: "DELETE" });
    expect(anon.status).toBe(401);
  });

  it("requires authentication to start pairing and at least one scope", async () => {
    const app = buildApp(openTestDb(), new AdapterRegistry());

    const anonymous = await app.request("/devices/pairing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rogue", scopes: ["read"] }),
    });
    expect(anonymous.status).toBe(401);

    const noScopes = await app.request("/devices/pairing", {
      method: "POST",
      headers: masterHeaders(),
      body: JSON.stringify({ name: "Nothing", scopes: [] }),
    });
    expect(noScopes.status).toBe(400);

    const badScope = await app.request("/devices/pairing", {
      method: "POST",
      headers: masterHeaders(),
      body: JSON.stringify({ name: "Root", scopes: ["root"] }),
    });
    expect(badScope.status).toBe(400);
  });
});
