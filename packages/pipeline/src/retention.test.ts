import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { signals, events } from "@mind/core";
import { runRetention } from "./retention.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function insertSignal(
  db: ReturnType<typeof openTestDb>,
  id: string,
  body: string,
  receivedAt: Date,
) {
  db.insert(signals)
    .values({
      id,
      adapter: "test",
      externalId: id,
      threadId: null,
      sender: "alice@example.com",
      recipients: JSON.stringify(["me@example.com"]),
      kind: "message",
      body,
      receivedAt: receivedAt.toISOString(),
      urgencyHint: null,
      disposition: "new",
      dedupeKey: `test:${id}`,
    })
    .run();
}

// Default retention is 30 days via MIND_RETENTION_DAYS env, but we override.
const RETENTION_DAYS = 7;

describe("runRetention", () => {
  beforeEach(() => {
    process.env["MIND_RETENTION_DAYS"] = String(RETENTION_DAYS);
  });

  afterEach(() => {
    delete process.env["MIND_RETENTION_DAYS"];
  });

  it("redacts signal body when signal is older than the retention window", () => {
    const db = openTestDb();
    const old = new Date(Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    insertSignal(db, "s-old", "original body", old);

    runRetention(db);

    const row = db.select().from(signals).all()[0];
    expect(row?.body).toBe(`[redacted after ${RETENTION_DAYS}d]`);
  });

  it("leaves signal body untouched when signal is within the retention window", () => {
    const db = openTestDb();
    const recent = new Date(Date.now() - (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000);
    insertSignal(db, "s-new", "keep me", recent);

    runRetention(db);

    const row = db.select().from(signals).all()[0];
    expect(row?.body).toBe("keep me");
  });

  it("does not double-redact a signal that is already redacted", () => {
    const db = openTestDb();
    const old = new Date(Date.now() - (RETENTION_DAYS + 2) * 24 * 60 * 60 * 1000);
    const alreadyRedacted = `[redacted after ${RETENTION_DAYS}d]`;
    insertSignal(db, "s-already", alreadyRedacted, old);

    runRetention(db);

    // Body must remain exactly the same string — no double-redact.
    const row = db.select().from(signals).all()[0];
    expect(row?.body).toBe(alreadyRedacted);

    // And no event should have been written (count = 0 means nothing done).
    const evs = db.select().from(events).all();
    expect(evs).toHaveLength(0);
  });

  it("writes an event row with the correct redacted count", () => {
    const db = openTestDb();
    const old = new Date(Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    insertSignal(db, "s-1", "body one", old);
    insertSignal(db, "s-2", "body two", old);

    runRetention(db);

    const evs = db.select().from(events).all();
    expect(evs).toHaveLength(1);
    const payload = JSON.parse(evs[0]!.payload) as { count: number };
    expect(payload.count).toBe(2);
    expect(evs[0]?.kind).toBe("signals.redacted");
    expect(evs[0]?.actor).toBe("system");
  });
});
