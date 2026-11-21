#!/usr/bin/env node
/**
 * Migration immutability guard.
 *
 * An applied migration must never change: add a new one instead. This fails when
 * any file under packages/core/migrations was modified, deleted, or renamed
 * relative to the base ref. Adding files is allowed.
 *
 * Usage: node scripts/check-migrations.mjs [baseRef]   (default: HEAD)
 * Exit:  0 clean, 1 an existing migration changed.
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] ?? "HEAD";
const range = base === "HEAD" ? ["HEAD"] : [`${base}...HEAD`];

const out = execFileSync(
  "git",
  ["diff", "--name-status", "--diff-filter=MDR", ...range, "--", "packages/core/migrations"],
  { cwd: ROOT, encoding: "utf8" },
).trim();

// meta/_journal.json and snapshots are appended to by drizzle-kit on every new
// migration, so a modification there is expected; only the .sql files are frozen.
const bad = out
  .split("\n")
  .filter(Boolean)
  .filter((l) => /\.sql\s*$/.test(l));

if (bad.length > 0) {
  console.error("An applied migration was modified, deleted, or renamed:\n" + bad.join("\n"));
  console.error("\nRevert it and add a new migration instead.");
  process.exit(1);
}
console.log("migrations: no applied migration changed");
