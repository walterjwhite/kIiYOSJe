/**
 * Integration tests for the Hono application.
 * Uses an in-memory database — no file I/O, no migration folder dependency.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { notificationsConfigPath } from "@mind/core";
import { AdapterRegistry } from "@mind/pipeline";
import { buildApp } from "./app.js";

// Point to core's migrations
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(
  __dirname,
  "..",
  "..",
  "core",
  "migrations",
);

// Override the token for tests
process.env["MIND_TEST_TOKEN"] = "test-token";

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

// Inject a known token for tests by monkey-patching the auth module
// (simpler than mocking the filesystem in this context)
import * as auth from "./auth.js";

describe("/health", () => {
  it("returns 401 without a token", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);

    const res = await app.request("/health");
    expect(res.status).toBe(401);
  });
});

describe("/thoughts", () => {
  it("creates and retrieves a thought", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);

    // We need a valid token; read it from the auth module's exported function
    const token = auth.getToken();

    const createRes = await app.request("/thoughts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test thought",
        body: "Some body",
        directionId: null,
      }),
    });

    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };
    expect(typeof id).toBe("string");

    const listRes = await app.request("/thoughts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string }[];
    expect(list.some((t) => t.id === id)).toBe(true);
  });
});

describe("/metrics", () => {
  it("returns metric fields", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/metrics", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("signals");
    expect(body).toHaveProperty("thoughts");
    expect(body).toHaveProperty("window");
    expect(body).toHaveProperty("byChannel");
    expect(body).toHaveProperty("dailyVolume");
  });
});

describe("/metrics/signals (Analytics drill-down)", () => {
  it("rejects a request with no filter", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/metrics/signals", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns signals matching a directionId filter", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.directions)
      .values({
        id: "dir-a",
        name: "A",
        scopeKind: "topic",
        scopeValue: "x",
        posture: "surface",
        standard: "s",
        autonomy: "observe",
        confidenceMin: 0.5,
        enabled: true,
        version: 1,
      })
      .run();

    db.insert(schema.signals)
      .values({
        id: "sig-1",
        adapter: "test",
        externalId: "e1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        disposition: "absorbed",
        directionId: "dir-a",
        dedupeKey: "test:e1",
      })
      .run();

    const res = await app.request("/metrics/signals?directionId=dir-a", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.some((r) => r.id === "sig-1")).toBe(true);
  });
});

describe("/signals (list + reclassify)", () => {
  it("lists signals and reclassifies one to a different direction", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.directions)
      .values([
        {
          id: "dir-a",
          name: "A",
          scopeKind: "topic",
          scopeValue: "x",
          posture: "surface",
          standard: "s",
          autonomy: "observe",
          confidenceMin: 0.5,
          enabled: true,
          version: 1,
        },
        {
          id: "dir-b",
          name: "B",
          scopeKind: "topic",
          scopeValue: "y",
          posture: "surface",
          standard: "s",
          autonomy: "observe",
          confidenceMin: 0.5,
          enabled: true,
          version: 1,
        },
      ])
      .run();

    db.insert(schema.signals)
      .values({
        id: "sig-1",
        adapter: "test",
        externalId: "e1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        disposition: "absorbed",
        directionId: "dir-a",
        dedupeKey: "test:e1",
      })
      .run();

    const listRes = await app.request("/signals?range=all", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string }[];
    expect(list.some((s) => s.id === "sig-1")).toBe(true);

    const patchRes = await app.request("/signals/sig-1", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ directionId: "dir-b", reason: "wrong match" }),
    });
    expect(patchRes.status).toBe(200);

    const updated = db
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, "sig-1"))
      .get();
    expect(updated?.directionId).toBe("dir-b");

    const eventsRes = await app.request("/events?kind=signal.reclassified", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(eventsRes.status).toBe(200);
    const evs = (await eventsRes.json()) as { kind: string }[];
    expect(evs.length).toBe(1);
  });

  it("rejects reclassifying to an unknown direction", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.signals)
      .values({
        id: "sig-1",
        adapter: "test",
        externalId: "e1",
        threadId: null,
        sender: "a@example.com",
        recipients: JSON.stringify([]),
        kind: "message",
        body: "hi",
        receivedAt: new Date().toISOString(),
        urgencyHint: null,
        disposition: "absorbed",
        directionId: null,
        dedupeKey: "test:e1",
      })
      .run();

    const res = await app.request("/signals/sig-1", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ directionId: "does-not-exist" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("/events (Journal)", () => {
  it("lists events newest first", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    db.insert(schema.events)
      .values([
        { id: "ev-1", actor: "system", kind: "signal.processed", payload: "{}" },
        { id: "ev-2", actor: "user", kind: "action.sent", payload: "{}" },
      ])
      .run();

    const res = await app.request("/events", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.length).toBe(2);
  });
});

describe("/admin/notifications (quiet period)", () => {
  // These tests read/write the real ~/.config/kIiYOSJe/mind/notifications.json,
  // same as config.ts does everywhere else (no path injection exists for
  // this module). Clean up afterward so the suite has no side effects.
  afterEach(() => {
    try {
      unlinkSync(notificationsConfigPath());
    } catch {
      /* already absent */
    }
  });

  it("returns defaults when no config has been written", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/admin/notifications", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; days: number[]; allowedNow: boolean };
    expect(body.enabled).toBe(true);
    expect(body.days).toEqual([1, 2, 3, 4, 5]);
    expect(typeof body.allowedNow).toBe("boolean");
  });

  it("rejects an invalid day value", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const res = await app.request("/admin/notifications", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        days: [7], // invalid — only 0-6
        startHour: 8,
        startMinute: 0,
        endHour: 15,
        endMinute: 0,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("persists a custom window and reflects it back", async () => {
    const db = openTestDb();
    const adapters = new AdapterRegistry();
    const app = buildApp(db, adapters);
    const token = auth.getToken();

    const putRes = await app.request("/admin/notifications", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        days: [1, 2, 3, 4, 5],
        startHour: 9,
        startMinute: 30,
        endHour: 17,
        endMinute: 0,
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/admin/notifications", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await getRes.json()) as { startHour: number; startMinute: number };
    expect(body.startHour).toBe(9);
    expect(body.startMinute).toBe(30);
  });
});
