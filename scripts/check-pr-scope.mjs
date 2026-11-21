#!/usr/bin/env node
/**
 * Flags pull requests that touch paths an automated agent must not change
 * without a human decision. Used by .github/workflows/agent-guard.yml.
 *
 * Usage: node scripts/check-pr-scope.mjs <baseRef> [--allow-protected]
 * Exit:  0 ok, 1 protected path touched without --allow-protected.
 *
 * The workflow passes --allow-protected only when the PR carries the
 * `human-approved-scope` label, which only a maintainer can apply.
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// MIND_REPO_ROOT lets CI run a trusted copy of this script against another checkout.
const ROOT = process.env.MIND_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2];
if (!base) {
  console.error("usage: check-pr-scope.mjs <baseRef> [--allow-protected]");
  process.exit(2);
}
const allow = process.argv.includes("--allow-protected");

const PROTECTED = [
  [/^LICENSE$|^extension\/LICENSE$/, "license text"],
  [/^\.kiro\/steering\/(licensing|product|security)\.md$/, "policy steering"],
  [/^\.github\//, "CI, templates, and ownership"],
  [/^scripts\/check-/, "quality-gate scripts"],
  [/^SECURITY\.md$|^CODEOWNERS$/, "security policy"],
  [/^packages\/core\/migrations\/.*\.sql$/, "database migration (needs human schema review)"],
  [/^packages\/pipeline\/src\/decide\.ts$/, "send-gate logic"],
  [/^packages\/server\/src\/auth\.ts$/, "authentication"],
  [/^\.gitignore$/, "ignore rules for secrets"],
];

const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const hits = changed.flatMap((f) =>
  PROTECTED.filter(([re]) => re.test(f)).map(([, why]) => `${f}  (${why})`),
);

if (hits.length > 0 && !allow) {
  console.error("This PR touches protected paths:\n  " + hits.join("\n  "));
  console.error("\nA maintainer must review the scope and apply the `human-approved-scope` label.");
  process.exit(1);
}
console.log(hits.length ? "protected paths touched, scope approved" : "no protected paths touched");
