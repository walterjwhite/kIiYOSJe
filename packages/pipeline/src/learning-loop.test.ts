import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { directions, signals, actions, events } from "@mind/core";
import { runLearningLoop } from "./learning-loop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

type TestDb = ReturnType<typeof openTestDb>;

function addDirection(db: TestDb, id: string, over: Partial<typeof directions.$inferInsert> = {}) {
  db.insert(directions)
    .values({
      id,
      name: id,
      scopeKind: "person",
      scopeValue: `${id}@x.com`,
      posture: "absorb",
      standard: "s",
      autonomy: "draft",
      confidenceMin: 0.7,
      enabled: true,
      version: 1,
      ...over,
    })
    .run();
}

function addAction(db: TestDb, dirId: string, n: number, status: string) {
  const sid = `s-${dirId}-${n}-${status}`;
  db.insert(signals)
    .values({
      id: sid,
      adapter: "t",
      externalId: sid,
      sender: "a@x.com",
      recipients: "[]",
      kind: "m",
      body: "b",
      receivedAt: new Date().toISOString(),
      disposition: "absorbed",
      directionId: dirId,
      dedupeKey: sid,
    })
    .run();
  db.insert(actions)
    .values({
      id: `a-${sid}`,
      signalId: sid,
      kind: "reply",
      payload: "{}",
      status,
      adapter: "t",
    })
    .run();
}

describe("runLearningLoop", () => {
  it("proposes narrowing when override rate exceeds 20%", () => {
    const db = openTestDb();
    addDirection(db, "d1");
    for (let i = 0; i < 2; i++) addAction(db, "d1", i, "sent");
    for (let i = 0; i < 2; i++) addAction(db, "d1", i, "discarded");

    const proposals = runLearningLoop(db);
    const p = proposals.find((x) => x.directionId === "d1");
    expect(p?.kind).toBe("narrow");
    expect(p?.field).toBe("confidenceMin");
    expect(p?.proposedValue).toBe(0.75);
  });

  it("proposes widening autonomy when approvals are consistent", () => {
    const db = openTestDb();
    addDirection(db, "d1", { autonomy: "draft" });
    for (let i = 0; i < 12; i++) addAction(db, "d1", i, "sent");

    const p = runLearningLoop(db).find((x) => x.directionId === "d1");
    expect(p?.kind).toBe("widen");
    expect(p?.proposedValue).toBe("send");
  });

  it("makes no proposal below the minimum sample", () => {
    const db = openTestDb();
    addDirection(db, "d1");
    addAction(db, "d1", 0, "discarded");
    addAction(db, "d1", 1, "discarded");

    expect(runLearningLoop(db)).toHaveLength(0);
  });

  it("proposes a new direction for repeated unmatched senders", () => {
    const db = openTestDb();
    for (let i = 0; i < 3; i++) {
      db.insert(signals)
        .values({
          id: `u-${i}`,
          adapter: "t",
          externalId: `u-${i}`,
          sender: "repeat@x.com",
          recipients: "[]",
          kind: "m",
          body: "b",
          receivedAt: new Date().toISOString(),
          disposition: "escalated",
          directionId: null,
          dedupeKey: `u-${i}`,
        })
        .run();
    }
    const p = runLearningLoop(db).find((x) => x.kind === "new");
    expect(p?.proposedValue).toBe("repeat@x.com");
  });

  it("persists each proposal as an event and never edits directions", () => {
    const db = openTestDb();
    addDirection(db, "d1");
    for (let i = 0; i < 2; i++) addAction(db, "d1", i, "sent");
    for (let i = 0; i < 2; i++) addAction(db, "d1", i, "discarded");

    runLearningLoop(db);

    const ev = db
      .select()
      .from(events)
      .all()
      .filter((e) => e.kind === "direction.proposal");
    expect(ev).toHaveLength(1);
    const dir = db.select().from(directions).all()[0];
    expect(dir?.confidenceMin).toBe(0.7);
  });
});
