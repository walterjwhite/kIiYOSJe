import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { directions } from "@mind/core";
import { matchSignal } from "./match.js";
import { ensureFallbackDirection, FALLBACK_DIRECTION_ID } from "./fallback-direction.js";
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

const signal: NewSignal = {
  adapter: "test",
  externalId: "m-1",
  threadId: null,
  sender: "alice@example.com",
  recipients: ["me@example.com"],
  kind: "message",
  body: "Can you review the quarterly report?",
  receivedAt: new Date(),
  urgencyHint: null,
};

describe("matchSignal", () => {
  it("returns null when no directions exist and fallback is absent", () => {
    const db = openTestDb();
    expect(matchSignal(db, signal)).toBeNull();
  });

  it("returns the fallback when no explicit direction matches", () => {
    const db = openTestDb();
    ensureFallbackDirection(db);
    const result = matchSignal(db, signal);
    expect(result?.direction.id).toBe(FALLBACK_DIRECTION_ID);
    expect(result?.isFallback).toBe(true);
  });

  it("explicit person-scope direction wins over catch-all", () => {
    const db = openTestDb();
    ensureFallbackDirection(db);

    db.insert(directions)
      .values({
        id: "work/alice",
        name: "alice",
        scopeKind: "person",
        scopeValue: "alice@example.com",
        posture: "absorb",
        standard: "Reply promptly.",
        autonomy: "draft",
        confidenceMin: 0.7,
        guards: null,
        enabled: true,
        version: 1,
      })
      .run();

    const result = matchSignal(db, signal);
    expect(result?.direction.id).toBe("work/alice");
    expect(result?.isFallback).toBe(false);
    expect(result?.specificity).toBe(4); // person specificity
  });

  it("disabled directions are ignored", () => {
    const db = openTestDb();
    ensureFallbackDirection(db);

    db.insert(directions)
      .values({
        id: "work/alice",
        name: "alice",
        scopeKind: "person",
        scopeValue: "alice@example.com",
        posture: "absorb",
        standard: "Reply promptly.",
        autonomy: "draft",
        confidenceMin: 0.7,
        guards: null,
        enabled: false, // disabled
        version: 1,
      })
      .run();

    const result = matchSignal(db, signal);
    // Falls back to catch-all since explicit direction is disabled.
    expect(result?.direction.id).toBe(FALLBACK_DIRECTION_ID);
  });

  it("topic-scope direction matches by keyword", () => {
    const db = openTestDb();
    ensureFallbackDirection(db);

    db.insert(directions)
      .values({
        id: "topic/report",
        name: "reports",
        scopeKind: "topic",
        scopeValue: "quarterly report",
        posture: "surface",
        standard: "Surface for review.",
        autonomy: "observe",
        confidenceMin: 0.6,
        guards: null,
        enabled: true,
        version: 1,
      })
      .run();

    const result = matchSignal(db, signal);
    expect(result?.direction.id).toBe("topic/report");
    expect(result?.isFallback).toBe(false);
  });

  it("matchPrompt phrase catches wording the literal scope value misses", () => {
    const db = openTestDb();
    ensureFallbackDirection(db);

    // scopeValue is a keyword that won't appear verbatim in the signal body,
    // but matchPrompt lists a phrase that does (STATUS.md gap #12).
    db.insert(directions)
      .values({
        id: "topic/status-update",
        name: "status updates",
        scopeKind: "topic",
        scopeValue: "status-update-keyword-not-present",
        posture: "surface",
        standard: "Surface for review.",
        autonomy: "observe",
        confidenceMin: 0.6,
        guards: null,
        matchPrompt: "review the quarterly report, send a status update",
        enabled: true,
        version: 1,
      })
      .run();

    const result = matchSignal(db, signal);
    expect(result?.direction.id).toBe("topic/status-update");
    expect(result?.isFallback).toBe(false);
  });

  it("matchPrompt alone does not match when no phrase is present", () => {
    const db = openTestDb();
    ensureFallbackDirection(db);

    db.insert(directions)
      .values({
        id: "topic/unrelated",
        name: "unrelated",
        scopeKind: "topic",
        scopeValue: "nope",
        posture: "surface",
        standard: "Surface for review.",
        autonomy: "observe",
        confidenceMin: 0.6,
        guards: null,
        matchPrompt: "totally unrelated phrase, something else entirely",
        enabled: true,
        version: 1,
      })
      .run();

    const result = matchSignal(db, signal);
    expect(result?.direction.id).toBe(FALLBACK_DIRECTION_ID);
  });

  describe("inflected wording", () => {
    function withTopic(scopeValue: string, matchPrompt: string | null = null) {
      const db = openTestDb();
      ensureFallbackDirection(db);
      db.insert(directions)
        .values({
          id: "topic/x",
          name: "x",
          scopeKind: "topic",
          scopeValue,
          posture: "absorb",
          standard: "s",
          autonomy: "draft",
          confidenceMin: 0.7,
          guards: null,
          matchPrompt,
          enabled: true,
          version: 1,
        })
        .run();
      return db;
    }
    const say = (body: string): NewSignal => ({ ...signal, body });

    it("matches a scope phrase through different word forms", () => {
      const db = withTopic("approve budget");
      expect(matchSignal(db, say("Approving budgets is on the agenda."))?.direction.id).toBe(
        "topic/x",
      );
    });

    it("still matches the literal substring it matched before", () => {
      const db = withTopic("standup");
      expect(matchSignal(db, say("Moving the standups to 9"))?.direction.id).toBe("topic/x");
    });

    it("matches matchPrompt phrases through different word forms", () => {
      const db = withTopic("zzz", "send invoice");
      expect(matchSignal(db, say("We are sending invoices on Friday"))?.direction.id).toBe(
        "topic/x",
      );
    });

    it("does not match words in a different order or non-adjacent", () => {
      const db = withTopic("approve budget");
      expect(matchSignal(db, say("Approve the budget"))?.isFallback).toBe(true);
    });
  });
});
