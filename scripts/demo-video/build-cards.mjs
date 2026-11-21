#!/usr/bin/env node
/**
 * Render the two non-screenshot cards (title, overview) to PNG frames.
 *
 *   node scripts/demo-video/build-cards.mjs [--frames DIR] [--force]
 *
 * Everything else in the video is a real screenshot. These two are the only
 * typographic cards, and they are rendered from cards/*.html so they can be
 * edited without touching a design tool. Uses whichever Chromium is on PATH;
 * set CHROMIUM to override.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const argv = process.argv.slice(2);
const framesIndex = argv.indexOf("--frames");
const frameDir = path.resolve(
  framesIndex >= 0 && argv[framesIndex + 1] ? argv[framesIndex + 1] : path.join(here, "frames"),
);
const force = argv.includes("--force");
const chromium = process.env.CHROMIUM || "chromium";
const width = 1920;
const height = 1080;

const cards = [
  { id: "01-title", file: path.join(here, "cards/title.html") },
  { id: "02-overview", file: path.join(here, "cards/overview.html") },
];

mkdirSync(frameDir, { recursive: true });

// Chromium refuses its sandbox when the build runs as root (containers, some CI).
const sandbox = process.getuid?.() === 0 ? ["--no-sandbox"] : [];

for (const card of cards) {
  const output = path.join(frameDir, `${card.id}.png`);
  if (existsSync(output) && !force) {
    console.log(`keep   ${output} (use --force to re-render)`);
    continue;
  }
  execFileSync(
    chromium,
    [
      "--headless=new",
      ...sandbox,
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      "--virtual-time-budget=2000",
      `--screenshot=${output}`,
      `file://${card.file}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  console.log(`render ${output}`);
}

console.log(`\n${cards.length} cards in ${frameDir}`);
