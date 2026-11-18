import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@mind/core";
import { directions, parseCommitment } from "@mind/core";
import type { NewSignal } from "@mind/core";
import { AdapterRegistry } from "./adapter-registry.js";
import { ensureFallbackDirection } from "./fallback-direction.js";
import {
  ingest,
  markThreadAwaitingReply,
  type IngestOverrides,
} from "./ingest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

const classifier = {
  confidence: 0.95,
  intent: "review request",
  signalKind: "task" as const,
  urgency: "low" as const,
  commitment: null,
  commitmentDueDate: null,
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

    expect(result.disposition).toBe("promoted");
    expect(result.signalId).not.toBeNull();
    expect(result.thoughtId).not.toBeNull();
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

    expect(duplicate.disposition).toBe("duplicate");
    expect(duplicate.signalId).toBeNull();
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

    expect(result.disposition).toBe("escalated");
    expect(db.select().from(schema.thoughts).get()?.state).toBe("active");
  });

  it("files an absorb signal when the drafter returns nothing", async () => {
    const db = setup("absorb");
    const result = await ingest(db, signal, new AdapterRegistry(), overrides(null));

    expect(result.disposition).toBe("filed");
    expect(result.reason).toBe("drafter not configured");
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
    expect(result.disposition).toBe("escalated");
  });

  it("supersedes a commitment restated with a new date in the same thread", async () => {
    const db = setup("surface");
    const first = await ingest(db, signal, new AdapterRegistry(), {
      classifierOutput: {
        ...classifier,
        commitment: "review the quarterly report",
        commitmentDueDate: "2026-11-20T17:00:00.000Z",
      },
    });

    const second = await ingest(
      db,
      {
        ...signal,
        externalId: "m-2",
        body: "Pushing the review to Wednesday.",
        receivedAt: new Date("2026-11-15T10:00:00.000Z"),
      },
      new AdapterRegistry(),
      {
        classifierOutput: {
          ...classifier,
          commitment: "review the quarterly report",
          commitmentDueDate: "2026-11-25T17:00:00.000Z",
        },
      },
    );

    // The same Thought is updated, not duplicated: two live reminders for one
    // promise is the failure this exists to prevent.
    expect(second.thoughtId).toBe(first.thoughtId);
    expect(db.select().from(schema.thoughts).all()).toHaveLength(1);

    const thought = db.select().from(schema.thoughts).get();
    const commitment = parseCommitment(thought?.commitment ?? null);
    expect(commitment?.status).toBe("changed");
    expect(commitment?.dueDate).toBe("2026-11-25T17:00:00.000Z");
    expect(commitment?.previousStates).toHaveLength(1);
    expect(commitment?.previousStates[0]?.dueDate).toBe(
      "2026-11-20T17:00:00.000Z",
    );
    expect(
      db
        .select()
        .from(schema.events)
        .all()
        .filter((event) => event.kind === "commitment.superseded"),
    ).toHaveLength(1);
  });

  it("verifies rather than supersedes when the promise is restated unchanged", async () => {
    const db = setup("surface");
    const output = {
      ...classifier,
      commitment: "review the quarterly report",
      commitmentDueDate: "2026-11-20T17:00:00.000Z",
    };

    const first = await ingest(db, signal, new AdapterRegistry(), {
      classifierOutput: output,
    });
    const second = await ingest(
      db,
      {
        ...signal,
        externalId: "m-2",
        body: "Still on for Friday.",
        receivedAt: new Date("2026-11-15T10:00:00.000Z"),
      },
      new AdapterRegistry(),
      { classifierOutput: output },
    );

    expect(second.thoughtId).toBe(first.thoughtId);
    const commitment = parseCommitment(
      db.select().from(schema.thoughts).get()?.commitment ?? null,
    );
    expect(commitment?.status).toBe("proposed");
    expect(commitment?.previousStates).toHaveLength(0);
    expect(
      db
        .select()
        .from(schema.events)
        .all()
        .filter((event) => event.kind === "commitment.verified"),
    ).toHaveLength(1);
  });

  it("marks a waiting thread answered when the other side replies", async () => {
    const db = setup("surface");
    const first = await ingest(db, signal, new AdapterRegistry(), overrides());
    markThreadAwaitingReply(
      db,
      signal.threadId,
      new Date().toISOString(),
      first.thoughtId,
    );

    await ingest(
      db,
      {
        ...signal,
        externalId: "m-2",
        body: "Thanks — got it.",
        receivedAt: new Date("2026-11-15T10:00:00.000Z"),
      },
      new AdapterRegistry(),
      overrides(),
    );

    const rows = db.select().from(schema.signals).all();
    // Nothing is left waiting, and the signal whose reply went out carries the
    // timestamp that closed the wait. The inbound reply itself was never
    // waiting, so it correctly has no awaitingReplyAt.
    expect(rows.filter((row) => row.awaitingReplyAt && !row.replyReceivedAt)).toHaveLength(0);
    const original = rows.find((row) => row.externalId === "m-1");
    expect(original?.replyReceivedAt).not.toBeNull();
    expect(
      db
        .select()
        .from(schema.events)
        .all()
        .filter((event) => event.kind === "reply.received"),
    ).toHaveLength(1);
  });

  it("escalates to a disputed Thought when a confident answer is blocked", async () => {
    const db = setup("absorb");
    const result = await ingest(db, signal, new AdapterRegistry(), {
      classifierOutput: {
        ...classifier,
        signalKind: "question",
        answerable: false,
        answerBlocker: "needs the budget figure I don't have",
      },
      draftBody: "Sure, here is the number.",
    });

    expect(result.disposition).toBe("escalated");
    expect(result.reason).toBe("needs the budget figure I don't have");
    const thought = db.select().from(schema.thoughts).get();
    expect(thought?.state).toBe("disputed");
    expect(thought?.disputedReason).toBe("needs the budget figure I don't have");
    // No draft is proposed: a plausible wrong reply is the worse failure.
    expect(db.select().from(schema.actions).all()).toHaveLength(0);
  });

  it("leaves transformedSummary null when the matched direction has no transformPrompt", async () => {
    const db = setup("surface");
    await ingest(db, signal, new AdapterRegistry(), overrides());

    const row = db.select().from(schema.signals).get();
    expect(row?.transformedSummary).toBeNull();
  });

  it("stores the overridden transform result when the matched direction has a transformPrompt", async () => {
    const db = setup("surface");
    db.update(directions)
      .set({ transformPrompt: "Rewrite as: <one-line summary>" })
      .where(eq(directions.id, "work/alice"))
      .run();

    await ingest(db, signal, new AdapterRegistry(), {
      ...overrides(),
      transformedSummary: "Report review requested by Alice.",
    });

    const row = db.select().from(schema.signals).get();
    expect(row?.transformedSummary).toBe("Report review requested by Alice.");
    // The original body is untouched — the transform is additive, never a replacement.
    expect(row?.body).toContain("Can you review the quarterly report");
  });

  it("skips the transform call entirely when the matched direction has no transformPrompt, even without an override", async () => {
    const db = setup("surface");
    const result = await ingest(db, signal, new AdapterRegistry(), overrides());

    expect(result.disposition).toBe("promoted");
    const row = db.select().from(schema.signals).get();
    expect(row?.transformedSummary).toBeNull();
  });
});
