import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@mind/core";
import { directions } from "@mind/core";
import { loadDirections } from "./directions-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "core", "migrations");

function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "mind-test-"));
}

const VALID_YAML = `
name: test-direction
scope:
  kind: person
  value: alice@example.com
posture: absorb
autonomy: draft
confidenceMin: 0.8
standard: Reply promptly.
guards:
  escalateOn:
    - budget
`.trim();

describe("loadDirections", () => {
  it("inserts a valid direction file", () => {
    const db = openTestDb();
    const root = makeTempDir();
    writeFileSync(join(root, "alice.yaml"), VALID_YAML);

    loadDirections(db, root);

    const rows = db.select().from(directions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("test-direction");
    expect(rows[0]?.scopeValue).toBe("alice@example.com");
    expect(rows[0]?.confidenceMin).toBe(0.8);
  });

  it("uses the relative path as the direction ID", () => {
    const db = openTestDb();
    const root = makeTempDir();
    mkdirSync(join(root, "work"));
    writeFileSync(join(root, "work", "boss.yaml"), VALID_YAML);

    loadDirections(db, root);

    const rows = db.select().from(directions).all();
    expect(rows[0]?.id).toBe("work/boss");
  });

  it("increments version on reload", () => {
    const db = openTestDb();
    const root = makeTempDir();
    writeFileSync(join(root, "alice.yaml"), VALID_YAML);

    loadDirections(db, root);
    loadDirections(db, root);

    const rows = db.select().from(directions).all();
    expect(rows[0]?.version).toBe(2);
  });

  it("skips invalid YAML without throwing", () => {
    const db = openTestDb();
    const root = makeTempDir();
    writeFileSync(join(root, "bad.yaml"), "not: valid: direction: schema:");

    expect(() => loadDirections(db, root)).not.toThrow();
    const rows = db.select().from(directions).all();
    expect(rows).toHaveLength(0);
  });

  it("loads multiple files from nested directories", () => {
    const db = openTestDb();
    const root = makeTempDir();
    mkdirSync(join(root, "work"));
    mkdirSync(join(root, "personal"));
    writeFileSync(join(root, "work", "boss.yaml"), VALID_YAML);
    writeFileSync(join(root, "personal", "family.yaml"), VALID_YAML);

    loadDirections(db, root);

    const rows = db.select().from(directions).all();
    expect(rows).toHaveLength(2);
  });

  it("accepts 'guidance' as an alias for 'standard'", () => {
    const db = openTestDb();
    const root = makeTempDir();
    const yamlWithGuidance = `
name: guidance-alias
scope:
  kind: person
  value: bob@example.com
posture: absorb
autonomy: draft
confidenceMin: 0.8
guidance: Reply within one business day.
`.trim();
    writeFileSync(join(root, "bob.yaml"), yamlWithGuidance);

    loadDirections(db, root);

    const rows = db.select().from(directions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.standard).toBe("Reply within one business day.");
  });

  it("prefers 'standard' over 'guidance' when both are present", () => {
    const db = openTestDb();
    const root = makeTempDir();
    const yamlWithBoth = `
name: both-fields
scope:
  kind: person
  value: carol@example.com
posture: absorb
autonomy: draft
confidenceMin: 0.8
standard: Use this one.
guidance: Not this one.
`.trim();
    writeFileSync(join(root, "carol.yaml"), yamlWithBoth);

    loadDirections(db, root);

    const rows = db.select().from(directions).all();
    expect(rows[0]?.standard).toBe("Use this one.");
  });
});
