/**
 * Integration tests for the Hono application.
 * Uses an in-memory database — no file I/O, no migration folder dependency.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
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
  });
});
