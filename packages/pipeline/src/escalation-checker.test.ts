import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { thoughts, events } from "@mind/core";
import { runCheck } from "./escalation-checker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

describe("runCheck", () => {
  it("promotes overdue seedling thoughts to active", () => {
    const db = openTestDb();
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago

    db.insert(thoughts)
      .values({
        id: "t-1",
        title: "Overdue thought",
        body: "",
        state: "seedling",
        escalateBy: past,
      })
      .run();

    runCheck(db);

    const updated = db.select().from(thoughts).all();
    expect(updated[0]?.state).toBe("active");
  });

  it("does not promote seedlings whose deadline has not passed", () => {
    const db = openTestDb();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.insert(thoughts)
      .values({
        id: "t-1",
        title: "Future thought",
        body: "",
        state: "seedling",
        escalateBy: future,
      })
      .run();

    runCheck(db);

    const updated = db.select().from(thoughts).all();
    expect(updated[0]?.state).toBe("seedling");
  });

  it("does not promote seedlings with no escalateBy", () => {
    const db = openTestDb();

    db.insert(thoughts)
      .values({
        id: "t-1",
        title: "No deadline",
        body: "",
        state: "seedling",
        escalateBy: null,
      })
      .run();

    runCheck(db);

    const updated = db.select().from(thoughts).all();
    expect(updated[0]?.state).toBe("seedling");
  });

  it("writes an audit event for each promoted thought", () => {
    const db = openTestDb();
    const past = new Date(Date.now() - 1000).toISOString();

    db.insert(thoughts)
      .values([
        { id: "t-1", title: "A", body: "", state: "seedling", escalateBy: past },
        { id: "t-2", title: "B", body: "", state: "seedling", escalateBy: past },
      ])
      .run();

    runCheck(db);

    const ev = db.select().from(events).all();
    expect(ev.filter((e) => e.kind === "thought.escalated")).toHaveLength(2);
  });

  it("does not touch active, parked, or closed thoughts", () => {
    const db = openTestDb();
    const past = new Date(Date.now() - 1000).toISOString();

    db.insert(thoughts)
      .values([
        { id: "t-1", title: "Active", body: "", state: "active", escalateBy: past },
        { id: "t-2", title: "Parked", body: "", state: "parked", escalateBy: past },
        { id: "t-3", title: "Closed", body: "", state: "closed", escalateBy: past },
      ])
      .run();

    runCheck(db);

    const all = db.select().from(thoughts).all();
    expect(all.find((t) => t.id === "t-1")?.state).toBe("active");
    expect(all.find((t) => t.id === "t-2")?.state).toBe("parked");
    expect(all.find((t) => t.id === "t-3")?.state).toBe("closed");
  });
});
