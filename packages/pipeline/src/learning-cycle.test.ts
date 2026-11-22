import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { actions, directions, events, signals } from "@mind/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { lastLearningRun, runLearningCycle, scheduledRunDue } from "./learning-cycle.js";
import { runLearningLoop } from "./learning-loop.js";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
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
type TestDb = ReturnType<typeof openTestDb>;

/** A Direction with 2 sent and 2 discarded actions: a "narrow" proposal 0.7 → 0.75. */
function seedNarrowCase(db: TestDb) {
  db.insert(directions)
    .values({
      id: "d1",
      name: "d1",
      scopeKind: "person",
      scopeValue: "d1@x.com",
      posture: "absorb",
      standard: "s",
      autonomy: "draft",
      confidenceMin: 0.7,
      enabled: true,
      version: 1,
    })
    .run();
  for (const status of ["sent", "sent", "discarded", "discarded"]) {
    const sid = `s-${status}-${Math.random()}`;
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
        directionId: "d1",
        dedupeKey: sid,
      })
      .run();
    db.insert(actions)
      .values({ id: `a-${sid}`, signalId: sid, kind: "reply", payload: "{}", status, adapter: "t" })
      .run();
  }
}

function proposalEvents(db: TestDb) {
  return db
    .select()
    .from(events)
    .all()
    .filter((e) => e.kind === "direction.proposal");
}

function resolve(db: TestDb, proposalEventId: string, resolution: string, at: string) {
  db.insert(events)
    .values({
      id: `r-${proposalEventId}`,
      at,
      actor: "user",
      kind: "direction.proposal.resolved",
      payload: JSON.stringify({ proposalEventId, resolution }),
    })
    .run();
}

describe("proposal de-duplication", () => {
  it("does not store the same proposal twice while the first is pending", () => {
    const db = openTestDb();
    seedNarrowCase(db);
    expect(runLearningLoop(db)).toHaveLength(1);
    expect(runLearningLoop(db)).toHaveLength(0);
    expect(proposalEvents(db)).toHaveLength(1);
  });

  it("does not re-propose a rejected proposal within the cooldown", () => {
    const db = openTestDb();
    seedNarrowCase(db);
    runLearningLoop(db);
    const first = proposalEvents(db)[0];
    resolve(db, first?.id ?? "", "rejected", new Date().toISOString());
    expect(runLearningLoop(db)).toHaveLength(0);
  });

  it("proposes again once the cooldown after a rejection has passed", () => {
    const db = openTestDb();
    seedNarrowCase(db);
    runLearningLoop(db);
    const first = proposalEvents(db)[0];
    resolve(db, first?.id ?? "", "rejected", new Date(Date.now() - 31 * 86_400_000).toISOString());
    expect(runLearningLoop(db)).toHaveLength(1);
  });

  it("honors a custom cooldown", () => {
    const db = openTestDb();
    seedNarrowCase(db);
    runLearningLoop(db);
    const first = proposalEvents(db)[0];
    resolve(db, first?.id ?? "", "rejected", new Date(Date.now() - 2 * 86_400_000).toISOString());
    expect(runLearningLoop(db, { reproposeAfterDays: 1 })).toHaveLength(1);
  });

  it("does not re-propose an accepted proposal within the cooldown", () => {
    const db = openTestDb();
    seedNarrowCase(db);
    runLearningLoop(db);
    const first = proposalEvents(db)[0];
    resolve(db, first?.id ?? "", "accepted", new Date().toISOString());
    expect(runLearningLoop(db)).toHaveLength(0);
  });
});

describe("scheduledRunDue", () => {
  const window = { windowStart: "00:00", windowEnd: "04:00" };
  const night = new Date(2026, 0, 15, 1, 0);

  it("is due inside the window when nothing has run", () => {
    expect(scheduledRunDue(openTestDb(), night, window)).toBe(true);
  });

  it("is not due outside the window", () => {
    expect(scheduledRunDue(openTestDb(), new Date(2026, 0, 15, 14, 0), window)).toBe(false);
  });

  it("runs once per night", async () => {
    const db = openTestDb();
    await runLearningCycle(db, "schedule", night);
    expect(scheduledRunDue(db, new Date(2026, 0, 15, 3, 0), window)).toBe(false);
    expect(scheduledRunDue(db, new Date(2026, 0, 16, 1, 0), window)).toBe(true);
  });

  it("is not used up by a manual run", async () => {
    const db = openTestDb();
    await runLearningCycle(db, "manual", new Date(2026, 0, 15, 0, 30));
    expect(scheduledRunDue(db, night, window)).toBe(true);
    expect(lastLearningRun(db)?.trigger).toBe("manual");
    expect(lastLearningRun(db, "schedule")).toBeNull();
  });
});
