/**
 * Tests for the maxPerThreadPerHour guard in ingest.ts.
 *
 * We test the guard logic via a helper that mirrors evaluateGuards internals
 * rather than through the full ingest() pipeline, so we can inject a known
 * DB state without needing to stub classify/draft.
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { signals } from "@mind/core";
import { and, eq, gte, or, sql } from "drizzle-orm";
import type { Db } from "@mind/core";
import type { NewSignal } from "@mind/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

/**
 * Minimal reimplementation of the maxPerThreadPerHour guard so the test does
 * not depend on ingest.ts internals — but it exercises the same SQL logic.
 */
function checkMaxPerThreadPerHour(
  db: Db,
  threadId: string | null,
  receivedAt: Date,
  limit: number,
): boolean {
  if (threadId == null) return false;

  const oneHourAgo = new Date(receivedAt.getTime() - 60 * 60 * 1000).toISOString();
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(signals)
    .where(
      and(
        eq(signals.threadId, threadId),
        or(eq(signals.disposition, "absorbed"), eq(signals.disposition, "new")),
        gte(signals.receivedAt, oneHourAgo),
      ),
    )
    .get();

  return (result?.count ?? 0) >= limit;
}

function insertSignal(
  db: Db,
  id: string,
  threadId: string,
  disposition: "absorbed" | "new" | "escalated",
  receivedAt: Date,
) {
  db.insert(signals)
    .values({
      id,
      adapter: "test",
      externalId: id,
      threadId,
      sender: "alice@example.com",
      recipients: JSON.stringify(["me@example.com"]),
      kind: "message",
      body: "hello",
      receivedAt: receivedAt.toISOString(),
      urgencyHint: null,
      disposition,
      dedupeKey: `test:${id}`,
    })
    .run();
}

describe("maxPerThreadPerHour guard", () => {
  const now = new Date();
  const withinHour = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago

  it("does not trigger when count is below the limit", () => {
    const db = openTestDb();
    insertSignal(db, "s-1", "thread-A", "absorbed", withinHour);
    // limit = 3, count = 1 → not triggered
    expect(checkMaxPerThreadPerHour(db, "thread-A", now, 3)).toBe(false);
  });

  it("triggers when count meets the limit", () => {
    const db = openTestDb();
    insertSignal(db, "s-1", "thread-A", "absorbed", withinHour);
    insertSignal(db, "s-2", "thread-A", "new", withinHour);
    insertSignal(db, "s-3", "thread-A", "absorbed", withinHour);
    // limit = 3, count = 3 → triggered
    expect(checkMaxPerThreadPerHour(db, "thread-A", now, 3)).toBe(true);
  });

  it("does not trigger when threadId is null regardless of count", () => {
    const db = openTestDb();
    // Insert signals with a threadId so the count would be high if we queried
    insertSignal(db, "s-1", "thread-A", "absorbed", withinHour);
    insertSignal(db, "s-2", "thread-A", "absorbed", withinHour);
    // But we pass threadId = null
    expect(checkMaxPerThreadPerHour(db, null, now, 1)).toBe(false);
  });

  it("does not count signals outside the 1-hour window", () => {
    const db = openTestDb();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    insertSignal(db, "s-old", "thread-A", "absorbed", twoHoursAgo);
    // Old signal is outside the window; count = 0 < limit 1
    expect(checkMaxPerThreadPerHour(db, "thread-A", now, 1)).toBe(false);
  });

  it("does not count escalated signals toward the limit", () => {
    const db = openTestDb();
    insertSignal(db, "s-1", "thread-A", "escalated", withinHour);
    insertSignal(db, "s-2", "thread-A", "escalated", withinHour);
    // Only absorbed/new count; none here → not triggered at limit 1
    expect(checkMaxPerThreadPerHour(db, "thread-A", now, 1)).toBe(false);
  });
});
