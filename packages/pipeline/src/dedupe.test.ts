import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { signals } from "@mind/core";
import { dedupeKey, isDuplicate } from "./dedupe.js";
import type { NewSignal } from "@mind/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(
  __dirname,
  "..",
  "..",
  "core",
  "migrations",
);

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

const signal: NewSignal = {
  adapter: "test",
  externalId: "abc-123",
  threadId: null,
  sender: "alice@example.com",
  recipients: ["me@example.com"],
  kind: "message",
  body: "Hello",
  receivedAt: new Date(),
  urgencyHint: null,
};

describe("dedupeKey", () => {
  it("produces adapter:externalId", () => {
    expect(dedupeKey(signal)).toBe("test:abc-123");
  });
});

describe("isDuplicate", () => {
  it("returns false for a new signal", () => {
    const db = openTestDb();
    expect(isDuplicate(db, dedupeKey(signal))).toBe(false);
  });

  it("returns true after the signal is inserted", () => {
    const db = openTestDb();
    db.insert(signals)
      .values({
        id: "s-1",
        adapter: signal.adapter,
        externalId: signal.externalId,
        threadId: signal.threadId,
        sender: signal.sender,
        recipients: JSON.stringify(signal.recipients),
        kind: signal.kind,
        body: signal.body,
        receivedAt: signal.receivedAt.toISOString(),
        urgencyHint: signal.urgencyHint,
        disposition: "new",
        dedupeKey: dedupeKey(signal),
      })
      .run();

    expect(isDuplicate(db, dedupeKey(signal))).toBe(true);
  });
});
