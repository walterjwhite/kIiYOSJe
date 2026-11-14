/**
 * Opens (or creates) the SQLite database and runs pending migrations.
 * Returns the drizzle client. Call once at startup.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath, ensureDirs } from "../config.js";
import * as schema from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

export type Db = ReturnType<typeof buildDb>;

// Keep the raw better-sqlite3 instance so backup can call .backup() directly.
let _sqlite: InstanceType<typeof Database> | undefined;

function buildDb(path: string) {
  const sqlite = new Database(path, { fileMustExist: false });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  _sqlite = sqlite;
  return drizzle(sqlite, { schema });
}

let _db: Db | undefined;

export function getDb(): Db {
  if (!_db) {
    throw new Error("Database not initialised. Call openDb() first.");
  }
  return _db;
}

export function openDb(path?: string): Db {
  ensureDirs();
  const p = path ?? dbPath();
  _db = buildDb(p);
  migrate(_db, { migrationsFolder: MIGRATIONS_DIR });
  return _db;
}

/** Returns the raw better-sqlite3 Database instance for backup operations. */
export function getRawDb(): InstanceType<typeof Database> {
  if (!_sqlite) throw new Error("Database not initialised. Call openDb() first.");
  return _sqlite;
}

/** For tests: open an in-memory database without running migrations from disk. */
export function openMemoryDb(): Db {
  _db = buildDb(":memory:");
  return _db;
}
