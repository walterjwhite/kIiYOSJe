#!/usr/bin/env node
/**
 * Offline secret scan with no dependencies.
 *
 * Default: scans files changed relative to HEAD (modified, staged, untracked).
 * `--all`: scans every tracked file (used by CI).
 * `--base <ref>`: scans files changed since <ref> (used on pull requests).
 *
 * It is a tripwire for the obvious cases (provider keys, private keys, OAuth
 * refresh tokens, bearer literals), not a replacement for rotating a leaked
 * credential. A line containing `secret-scan:allow` is skipped, for fixtures
 * that use an obviously fake value.
 *
 * Exit: 0 clean, 1 finding.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// MIND_REPO_ROOT lets CI run a trusted copy of this script against another checkout.
const ROOT = process.env.MIND_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RULES = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{50,}\b/, "GitHub fine-grained token"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, "OpenAI-style API key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\b1\/\/[0-9A-Za-z_-]{40,}/, "Google OAuth refresh token"],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, "Slack token"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{40,}=*/, "bearer token literal"],
];

const SKIP_PATH = /(^|\/)(node_modules|dist)\/|\.(vsix|png|jpg|jpeg|gif|ico|lock)$|package-lock\.json$/;

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function candidateFiles() {
  const argv = process.argv.slice(2);
  if (argv.includes("--all")) return git("ls-files");
  const baseIdx = argv.indexOf("--base");
  if (baseIdx !== -1 && argv[baseIdx + 1]) {
    return git("diff", "--name-only", "--diff-filter=ACMR", `${argv[baseIdx + 1]}...HEAD`);
  }
  return [
    ...new Set([
      ...git("diff", "--name-only", "--diff-filter=ACMR", "HEAD"),
      ...git("ls-files", "--others", "--exclude-standard"),
    ]),
  ];
}

let findings = 0;
for (const rel of candidateFiles()) {
  if (SKIP_PATH.test(rel)) continue;
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile() || statSync(abs).size > 2_000_000) continue;
  const lines = readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("secret-scan:allow")) return;
    for (const [re, label] of RULES) {
      if (re.test(line)) {
        findings++;
        // Never print the match itself.
        console.error(`${rel}:${i + 1}: possible ${label}`);
      }
    }
  });
}

if (findings > 0) {
  console.error(`\n${findings} possible secret(s). Remove them and rotate the credential if it was real.`);
  process.exit(1);
}
console.log("secret scan: clean");
