import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@mind/core";
import { directions } from "@mind/core";
import type { NewSignal } from "@mind/core";
import { AdapterRegistry } from "./adapter-registry.js";
import { ensureFallbackDirection } from "./fallback-direction.js";
import { ingest, type IngestOverrides } from "./ingest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

const classifier = {
  confidence: 0.95,
  intent: "review request",
  signalKind: "task" as const,
  urgency: "low" as const,
  commitment: null,
  escalateBy: null,
  sensitiveTopics: [],
  answerable: true,
  answerBlocker: null,
};

const signal: NewSignal = {
  adapter: "test",
  externalId: "m-1",
  threadId: "t-1",
  sender: "alice@example.com",
  recipients: ["me@example.com"],
  kind: "email",
  subject: "Report",
  body: "Can you review the quarterly report?\n\n> old quoted text",
  receivedAt: new Date("2026-11-14T10:00:00.000Z"),
  urgencyHint: null,
};

function setup(posture = "absorb", confidenceMin = 0.5) {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  db.insert(directions)
    .values({
      id: "work/alice",
      name: "alice",
      scopeKind: "person",
      scopeValue: "alice@example.com",
      posture,
      standard: "Reply promptly.",
      autonomy: "draft",
      confidenceMin,
      enabled: true,
      version: 1,
    })
    .run();
  return db;
}

const overrides = (draftBody?: string | null): IngestOverrides => ({
  classifierOutput: classifier,
  ...(draftBody === undefined ? {} : { draftBody }),
});

beforeEach(() => {
  process.env["MIND_CONFIG_DIR"] = "/nonexistent-mind-test-config";
  process.env["MIND_DATA_DIR"] = "/nonexistent-mind-test-data";
});

describe("ingest", () => {
  it("stores the normalized body and records the disposition", async () => {
    const db = setup("surface");
    const result = await ingest(db, signal, new AdapterRegistry(), overrides());

    expect(result).toBe("promoted");
    const row = db.select().from(schema.signals).get();
    expect(row?.body).not.toContain("old quoted text");
    expect(
      db.select().from(schema.events).all().filter((e) => e.kind === "signal.processed"),
    ).toHaveLength(1);
  });

  it("creates a seedling Thought linked to the matched direction", async () => {
    const db = setup("surface");
    await ingest(db, signal, new AdapterRegistry(), overrides());

    const thought = db.select().from(schema.thoughts).get();
    expect(thought?.state).toBe("seedling");
    expect(thought?.directionId).toBe("work/alice");
  });

  it("drops a duplicate before anything else runs", async () => {
    const db = setup("surface");
    await ingest(db, signal, new AdapterRegistry(), overrides());
    const duplicate = await ingest(db, signal, new AdapterRegistry(), overrides());

    expect(duplicate).toBe("duplicate");
    expect(db.select().from(schema.signals).all()).toHaveLength(1);
  });

  it("escalates below the confidence floor and pins the thought active", async () => {
    const db = setup("surface", 0.99);
    const result = await ingest(
      db,
      signal,
      new AdapterRegistry(),
      { ...overrides(), classifierOutput: { ...classifier, confidence: 0.2 } },
    );

    expect(result).toBe("escalated");
    expect(db.select().from(schema.thoughts).get()?.state).toBe("active");
  });

  it("files an absorb signal when the drafter returns nothing", async () => {
    const db = setup("absorb");
    const result = await ingest(db, signal, new AdapterRegistry(), overrides(null));

    expect(result).toBe("filed");
    expect(db.select().from(schema.actions).all()).toHaveLength(0);
  });

  it("proposes a reply for an absorb signal with a draft", async () => {
    const db = setup("absorb");
    await ingest(db, signal, new AdapterRegistry(), overrides("On it."));

    const action = db.select().from(schema.actions).get();
    expect(action?.status).toBe("proposed");
    expect(JSON.parse(action?.payload ?? "{}").body).toBe("On it.");
  });

  it("uses the catch-all direction when nothing specific matches", async () => {
    const db = setup("surface");
    ensureFallbackDirection(db);

    const result = await ingest(
      db,
      { ...signal, sender: "stranger@example.com" },
      new AdapterRegistry(),
      { classifierOutput: { ...classifier, confidence: 0.3 } },
    );
    expect(result).toBe("escalated");
  });
});
