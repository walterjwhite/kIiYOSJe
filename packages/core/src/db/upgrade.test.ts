/**
 * Upgrade test: a database created before migration 0005, with rows in it,
 * must migrate forward without losing data.
 *
 * The other migration test proves a fresh install works. This one proves the
 * case that actually bites — an existing `mind.db` with a week of signal
 * history, upgraded in place. It builds a partial migrations folder (0000–0004),
 * inserts rows in the old shape, then migrates with the real folder.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");
const LAST_PRE_COMMITMENT_MIGRATION = 4;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/** A migrations folder that stops at the given index, for building an old DB. */
function partialMigrationsDir(upTo: number): string {
  const dir = mkdtempSync(join(tmpdir(), "mind-migrations-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "meta"), { recursive: true });

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const entries = journal.entries.filter((entry) => entry.idx <= upTo);

  for (const entry of entries) {
    cpSync(
      join(MIGRATIONS_DIR, `${entry.tag}.sql`),
      join(dir, `${entry.tag}.sql`),
    );
  }
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return dir;
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

describe("migration upgrade on a populated database", () => {
  it("adds the commitment and reply-tracking columns without losing rows", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });

    // 1. Bring the database to the state it had before this round.
    migrate(db, { migrationsFolder: partialMigrationsDir(LAST_PRE_COMMITMENT_MIGRATION) });

    // 2. Insert rows the old code would have written.
    sqlite.exec(`
      INSERT INTO directions
        (id, name, scope_kind, scope_value, posture, standard, autonomy, confidence_min, enabled, version)
      VALUES
        ('work/x', 'x', 'person', 'a@example.com', 'absorb', 'Reply.', 'draft', 0.7, 1, 1);
      INSERT INTO thoughts (id, title, body, state, direction_id)
      VALUES ('t1', 'Existing thought', 'body', 'seedling', 'work/x');
      INSERT INTO signals
        (id, adapter, external_id, sender, recipients, kind, body, received_at, disposition, dedupe_key, direction_id)
      VALUES
        ('s1', 'gmail', 'e1', 'a@example.com', '[]', 'email', 'hello',
         '2026-11-01T00:00:00.000Z', 'new', 'gmail:e1', 'work/x');
    `);

    expect(columnNames(sqlite, "thoughts")).not.toContain("commitment");

    // 3. Migrate forward with the real folder.
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    expect(columnNames(sqlite, "thoughts")).toEqual(
      expect.arrayContaining([
        "commitment",
        "disputed_reason",
        "awaiting_reply_at",
      ]),
    );
    expect(columnNames(sqlite, "signals")).toEqual(
      expect.arrayContaining(["awaiting_reply_at", "reply_received_at"]),
    );

    // 4. The rows that were there are still there, with nulls in the new columns.
    const thought = sqlite
      .prepare("SELECT title, commitment, disputed_reason FROM thoughts WHERE id = 't1'")
      .get() as { title: string; commitment: string | null; disputed_reason: string | null };
    expect(thought).toEqual({
      title: "Existing thought",
      commitment: null,
      disputed_reason: null,
    });

    const signal = sqlite
      .prepare("SELECT body, disposition, awaiting_reply_at FROM signals WHERE id = 's1'")
      .get() as { body: string; disposition: string; awaiting_reply_at: string | null };
    expect(signal).toEqual({
      body: "hello",
      disposition: "new",
      awaiting_reply_at: null,
    });

    sqlite.close();
  });
});
