#!/usr/bin/env node
/**
 * Tap the first (or last) on-screen element whose text or content description
 * matches, using adb + uiautomator. Keeps the Android capture script free of
 * hard-coded coordinates.
 *
 *   node scripts/demo-video/tap-text.mjs "Pair"
 *   node scripts/demo-video/tap-text.mjs --last "Capture"   # dialog button
 *
 * ADB_SERIAL selects a device; ADB overrides the adb binary.
 */
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const last = argv.includes("--last");
const target = argv
  .filter((argument) => argument !== "--last")
  .join(" ")
  .trim();
if (!target) {
  console.error('usage: tap-text.mjs [--last] "visible text"');
  process.exit(2);
}

const adb = process.env.ADB || "adb";
const serial = process.env.ADB_SERIAL ? ["-s", process.env.ADB_SERIAL] : [];
const decode = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

let xml;
try {
  xml = execFileSync(
    adb,
    [...serial, "exec-out", "uiautomator", "dump", "--compressed", "/dev/tty"],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
} catch {
  console.error(
    "error: uiautomator dump failed — is a device connected, unlocked and showing the app?",
  );
  process.exit(1);
}

const start = xml.indexOf("<hierarchy");
const end = xml.lastIndexOf("</hierarchy>");
if (start < 0 || end < 0) {
  console.error("error: no UI hierarchy in the uiautomator output");
  process.exit(1);
}

const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decode(match[1]) : "";
};

const candidates = [];
for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
  const node = match[0];
  const text = attribute(node, "text");
  const description = attribute(node, "content-desc");
  const label = text || description;
  const bounds = attribute(node, "bounds").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (!label || !bounds) continue;
  const [, x1, y1, x2, y2] = bounds.map(Number);
  let score = 0;
  if (label === target) score = 3;
  else if (label.toLowerCase().includes(target.toLowerCase())) score = 1;
  if (score === 0) continue;
  candidates.push({ score, x: (x1 + x2) / 2, y: (y1 + y2) / 2, label });
}

if (candidates.length === 0) {
  const labels = [...xml.matchAll(/<node\b[^>]*>/g)]
    .map((match) => attribute(match[0], "text") || attribute(match[0], "content-desc"))
    .filter(Boolean);
  console.error(`error: no element matching "${target}"`);
  if (labels.length > 0) console.error(`visible: ${[...new Set(labels)].join(" | ")}`);
  process.exit(1);
}

const best = Math.max(...candidates.map((candidate) => candidate.score));
const matches = candidates.filter((candidate) => candidate.score === best);
const chosen = last ? matches[matches.length - 1] : matches[0];
console.log(`tap    "${chosen.label}" at ${Math.round(chosen.x)},${Math.round(chosen.y)}`);
execFileSync(
  adb,
  [...serial, "shell", "input", "tap", String(Math.round(chosen.x)), String(Math.round(chosen.y))],
  {
    stdio: "inherit",
  },
);
