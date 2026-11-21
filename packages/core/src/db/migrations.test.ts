import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getRawDb, openDb } from "./client.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NEW_MIGRATION = "0003";

type Journal = { entries: { tag: string; when: number }[] };

/** A database as the previous release left it: old schema, old timestamps. */
function legacyDatabase(): string {
  const file = join(mkdtempSync(join(tmpdir(), "ki-legacy-")), "mind.db");
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  for (const name of legacyMigrations()) {
    db.exec(readSql(name).replaceAll("--> statement-breakpoint", ";"));
  }
  db.exec(
    "INSERT INTO directions (id, name, scope_kind, scope_value, posture, standard) VALUES ('d1','Legacy','person','alice@example.com','observe','std')",
  );
  db.exec("INSERT INTO thoughts (id, title) VALUES ('t1','Legacy thought')");
  db.exec("INSERT INTO events (id, actor, kind, payload) VALUES ('e1','system','test','{}')");
  db.exec(
    "INSERT INTO signals (id, adapter, external_id, sender, recipients, kind, body, received_at, dedupe_key, thought_id, direction_id) VALUES ('s1','test','x1','a@b.c','[]','mail','hi','2026-01-01T00:00:00.000Z','k1','t1','d1')",
  );
  db.exec(
    "INSERT INTO actions (id, kind, payload, adapter, thought_id) VALUES ('a1','draft','{}','test','t1')",
  );
  stampApplied(db);
  db.close();
  return file;
}

function legacyMigrations(): string[] {
  return sqlFiles().filter((name) => name < NEW_MIGRATION);
}

function sqlFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function readSql(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

/** Records the migrations that release had already run before this one. */
function stampApplied(db: InstanceType<typeof Database>): void {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  db.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  const insert = db.prepare(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  );
  for (const entry of journal.entries) {
    if (entry.tag >= NEW_MIGRATION) continue;
    insert.run(entry.tag, entry.when);
  }
}

describe("0003 iso timestamps", () => {
  it("rewrites timestamps written with datetime('now')", () => {
    openDb(legacyDatabase());
    const raw = getRawDb();
    const thought = raw
      .prepare("SELECT created_at, updated_at FROM thoughts WHERE id = 't1'")
      .get() as { created_at: string; updated_at: string };

    expect(thought.created_at).toMatch(ISO);
    expect(thought.updated_at).toMatch(ISO);
  });

  it("keeps rows and their foreign keys through the rebuild", () => {
    openDb(legacyDatabase());
    const raw = getRawDb();
    const counts = ["directions", "thoughts", "events", "signals", "actions"].map(
      (table) => (raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
    );

    expect(counts).toEqual([1, 1, 1, 1, 1]);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(raw.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() =>
      raw
        .prepare(
          "INSERT INTO actions (id, kind, payload, adapter, thought_id) VALUES ('a2','draft','{}','test','missing')",
        )
        .run(),
    ).toThrow();
  });

  it("defaults new rows to the same ISO format", () => {
    openDb(legacyDatabase());
    const raw = getRawDb();
    raw
      .prepare("INSERT INTO events (id, actor, kind, payload) VALUES ('e2','system','test','{}')")
      .run();
    const row = raw.prepare("SELECT at FROM events WHERE id = 'e2'").get() as {
      at: string;
    };

    expect(row.at).toMatch(ISO);
  });
});
