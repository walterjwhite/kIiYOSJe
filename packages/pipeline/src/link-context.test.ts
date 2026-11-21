import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { events, signals, thoughts } from "@mind/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { loadLinkContext } from "./link-context.js";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "core",
  "migrations",
);

function setup() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  db.insert(thoughts).values({ id: "g1", title: "Q4 report", body: "", state: "goal" }).run();
  db.insert(thoughts)
    .values({ id: "g2", title: "Review", body: "", state: "goal", parentId: "g1" })
    .run();
  db.insert(thoughts).values({ id: "p1", title: "Parked", body: "", state: "parked" }).run();
  db.insert(thoughts)
    .values({ id: "g3", title: "Child of parked", body: "", state: "goal", parentId: "p1" })
    .run();
  return db;
}

let n = 0;
function addSignal(
  db: ReturnType<typeof setup>,
  over: { sender?: string; subject?: string; threadId?: string; thoughtId?: string } = {},
) {
  const id = `s${++n}`;
  db.insert(signals)
    .values({
      id,
      adapter: "gmail",
      externalId: id,
      sender: over.sender ?? "a@example.com",
      recipients: "[]",
      kind: "email",
      subject: over.subject ?? null,
      body: "x",
      receivedAt: new Date().toISOString(),
      disposition: "promoted",
      dedupeKey: id,
      threadId: over.threadId ?? null,
      thoughtId: over.thoughtId ?? null,
    })
    .run();
  return id;
}

const link = (
  db: ReturnType<typeof setup>,
  signalId: string,
  thoughtId: string,
  actor: "user" | "system",
) =>
  db
    .insert(events)
    .values({
      id: `e${++n}`,
      actor,
      kind: "signal.thought_linked",
      payload: JSON.stringify({ signalId, thoughtId, auto: actor === "system" }),
    })
    .run();

describe("loadLinkContext", () => {
  it("returns open goals with the parent's title, even when the parent is parked", () => {
    const db = setup();
    const { goals } = loadLinkContext(db, { id: "new", threadId: null });
    const byId = Object.fromEntries(goals.map((g) => [g.id, g.parentTitle]));
    expect(byId).toEqual({ g1: null, g2: "Q4 report", g3: "Parked" });
  });

  it("uses manual links as examples, and ignores automatic ones", () => {
    const db = setup();
    const manual = addSignal(db, { subject: "Numbers", thoughtId: "g1" });
    const auto = addSignal(db, { subject: "Guess", thoughtId: "g1" });
    link(db, manual, "g1", "user");
    link(db, auto, "g1", "system");
    const { exemplars } = loadLinkContext(db, { id: "new", threadId: null });
    expect(exemplars).toEqual([{ goalId: "g1", sender: "a@example.com", subject: "Numbers" }]);
  });

  it("drops an example once the signal is unlinked or moved elsewhere", () => {
    const db = setup();
    const unlinked = addSignal(db, { subject: "Gone", thoughtId: "g1" });
    link(db, unlinked, "g1", "user");
    db.update(signals).set({ thoughtId: null }).run();
    const moved = addSignal(db, { subject: "Moved", thoughtId: "g2" });
    link(db, moved, "g1", "user");
    expect(loadLinkContext(db, { id: "new", threadId: null }).exemplars).toEqual([]);
  });

  it("reports the goals other messages in the same thread are linked to", () => {
    const db = setup();
    addSignal(db, { threadId: "t1", thoughtId: "g2" });
    addSignal(db, { threadId: "t2", thoughtId: "g1" });
    expect(loadLinkContext(db, { id: "new", threadId: "t1" }).threadGoalIds).toEqual(["g2"]);
    expect(loadLinkContext(db, { id: "new", threadId: null }).threadGoalIds).toEqual([]);
  });
});
