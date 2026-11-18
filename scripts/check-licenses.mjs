#!/usr/bin/env node
/**
 * License guard for the workspace.
 *
 * Reads package-lock.json (offline, no network) and fails when a dependency
 * carries a license this project cannot honor: strong copyleft, source-available
 * (BUSL / SSPL / Commons Clause), non-commercial or no-derivatives terms, or no
 * license at all. Weak/file-level copyleft (MPL, EPL, CDDL, LGPL) is allowed but
 * reported, because it is only safe while the package stays unmodified and
 * dev-only.
 *
 * Usage:  npm run license:check      (or: node scripts/check-licenses.mjs)
 * Exit:   0 clean or review-only, 1 on a denied license or a missing
 *         workspace license field.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DENY = [
  [/^A?GPL-/i, "strong copyleft"],
  [/^SSPL-/i, "source-available, not open source"],
  [/^BUSL-/i, "source-available, not open source"],
  [/^Commons-Clause/i, "no commercial use"],
  [/^CC-BY-NC/i, "non-commercial"],
  [/^CC-BY-ND/i, "no derivatives"],
  [/^UNLICENSED$/i, "no license granted"],
  [/^Proprietary$/i, "proprietary"],
  [/^SEE LICENSE IN/i, "points at a license file; review by hand"],
];

const REVIEW = [
  [/^L?GPL-/i, "weak copyleft: dynamic linking or dev-only only"],
  [/^MPL-/i, "file-level copyleft: do not modify the package"],
  [/^EPL-/i, "file-level copyleft: do not modify the package"],
  [/^CDDL-/i, "file-level copyleft: do not modify the package"],
  [/^CC-BY-/i, "attribution required"],
  [/^Artistic-/i, "review terms"],
];

/** Dual-licensed packages (`A OR B`) may be used under either, so pick the best. */
function classify(license) {
  // Strip parentheses so "(GPL-3.0)" is not mistaken for an unknown license.
  const text = String(license).replace(/[()]/g, "").trim();
  if (text.includes(" OR ")) {
    const parts = text.split(" OR ").map((part) => classify(part));
    const best = parts.find((part) => part.verdict !== "deny");
    if (best) return best;
    return parts[0];
  }
  for (const [re, why] of DENY) {
    if (re.test(text)) return { verdict: "deny", why };
  }
  for (const [re, why] of REVIEW) {
    if (re.test(text)) return { verdict: "review", why };
  }
  return { verdict: "ok", why: "" };
}

const lockPath = join(ROOT, "package-lock.json");
if (!existsSync(lockPath)) {
  console.error(`error: no lockfile at ${lockPath}`);
  process.exit(1);
}

const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const packages = Object.entries(lock.packages ?? {}).filter(
  ([path, meta]) => path.startsWith("node_modules/") && meta && !meta.link,
);

const counts = new Map();
const denied = [];
const review = [];
const unknown = [];

for (const [path, meta] of packages) {
  const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
  const license = meta.license;
  if (!license || String(license).trim() === "") {
    unknown.push(name);
    continue;
  }
  for (const variant of String(license).replace(/[()]/g, "").split(" OR ")) {
    counts.set(variant.trim(), (counts.get(variant.trim()) ?? 0) + 1);
  }
  const { verdict, why } = classify(license);
  if (verdict === "deny") denied.push({ name, license: String(license), why });
  if (verdict === "review") review.push({ name, license: String(license), why });
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`licenses in package-lock.json (${packages.length} packages)\n`);
for (const [license, count] of sorted) {
  console.log(`  ${String(count).padStart(4)}  ${license}`);
}

/** Every published package must declare a license, or its terms are unknowable. */
const manifests = [join(ROOT, "package.json"), join(ROOT, "extension", "package.json")];
const packagesDir = join(ROOT, "packages");
if (existsSync(packagesDir)) {
  for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
    if (dir.isDirectory()) manifests.push(join(packagesDir, dir.name, "package.json"));
  }
}
const missingLicense = [];
for (const manifest of manifests) {
  if (!existsSync(manifest)) continue;
  const parsed = JSON.parse(readFileSync(manifest, "utf8"));
  if (!parsed.license) missingLicense.push(parsed.name ?? manifest);
}

if (review.length > 0) {
  console.log(`\nreview (${review.length}) — allowed only while unmodified and/or dev-only:`);
  for (const { name, license, why } of review) {
    console.log(`  ${name} — ${license} (${why})`);
  }
}

if (unknown.length > 0) {
  console.log(`\nno license field (${unknown.length}) — verify by hand:`);
  for (const name of unknown) console.log(`  ${name}`);
}

if (missingLicense.length > 0) {
  console.error(`\nmissing "license" field (${missingLicense.length}):`);
  for (const name of missingLicense) console.error(`  ${name}`);
}

if (denied.length > 0) {
  console.error(`\ndenied (${denied.length}) — these cannot ship:`);
  for (const { name, license, why } of denied) {
    console.error(`  ${name} — ${license} (${why})`);
  }
}

if (denied.length > 0 || missingLicense.length > 0) {
  console.error("\nlicense check FAILED");
  process.exit(1);
}

console.log("\nlicense check passed");
