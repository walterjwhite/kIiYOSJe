import { describe, it, expect, beforeEach } from "vitest";
import { openMemoryDb } from "./client.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { signals, thoughts, directions, actions, events } from "./schema.js";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { sql } from "drizzle-orm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

describe("schema", () => {
  it("creates tables via migration and inserts a direction", () => {
    const db = openTestDb();

    db.insert(directions)
      .values({
        id: "d-1",
        name: "test-direction",
        scopeKind: "person",
        scopeValue: "alice@example.com",
        posture: "observe",
        standard: "Test standard.",
        autonomy: "observe",
        confidenceMin: 0.7,
        enabled: true,
        version: 1,
      })
      .run();

    const rows = db.select().from(directions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("test-direction");
  });

  it("enforces dedupeKey uniqueness on signals", () => {
    const db = openTestDb();

    const base = {
      id: "s-1",
      adapter: "test",
      externalId: "ext-1",
      threadId: null,
      sender: "alice@example.com",
      recipients: "[]",
      kind: "message",
      body: "hello",
      receivedAt: new Date().toISOString(),
      urgencyHint: null,
      disposition: "new" as const,
      dedupeKey: "test:ext-1",
    };

    db.insert(signals).values(base).run();

    expect(() =>
      db.insert(signals).values({ ...base, id: "s-2" }).run(),
    ).toThrow();
  });

  it("migration is idempotent — running twice does not throw", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    // second run must be a no-op
    expect(() =>
      migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    ).not.toThrow();
  });
});
