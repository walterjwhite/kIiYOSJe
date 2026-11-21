#!/usr/bin/env node
/**
 * Mask sensitive regions on the captured frames, then (optionally) check them.
 *
 *   node scripts/demo-video/mask.mjs [--frames DIR] [--out DIR] [--check]
 *
 * Raw captures in frames/ are never modified: every PNG is copied to
 * frames/masked/ and the masks declared on its shot in shots.json are applied
 * there. Pass 1 builds the video from the masked directory.
 *
 * A mask is a rectangle in source-image pixels:
 *
 *   "masks": [
 *     { "x": 40, "y": 120, "w": 420, "h": 30 },
 *     { "x": 40, "y": 160, "w": 420, "h": 30, "mode": "solid" }
 *   ]
 *
 * Blur is the default (radius 18, override with --radius). "solid" paints
 * black over the region instead, for anything that must not be readable even
 * as a silhouette.
 *
 * --check OCRs the masked frames with tesseract and exits 1 if it finds
 * something that still looks like an email address, a phone number, a card
 * number, an API key or a private key. --warn reports but never fails.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const shotsPath = path.resolve(value("--shots", path.join(here, "shots.json")));
const frameDir = path.resolve(value("--frames", path.join(here, "frames")));
const outDir = path.resolve(value("--out", path.join(here, "frames", "masked")));
const radius = Number(value("--radius", "18"));
const check = flag("--check");
const warnOnly = flag("--warn");
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const ffprobe = process.env.FFPROBE || "ffprobe";

const shots = JSON.parse(readFileSync(shotsPath, "utf8")).shots;
const byId = new Map(shots.map((shot) => [shot.id, shot]));

function imageSize(file) {
  const out = execFileSync(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  ).trim();
  const [width, height] = out.split(",").map(Number);
  return { width, height };
}

function filterFor(masks) {
  const parts = [];
  let input = "0:v";
  let output = "";
  masks.forEach((mask, index) => {
    const x = Math.round(mask.x);
    const y = Math.round(mask.y);
    const w = Math.round(mask.w);
    const h = Math.round(mask.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
      throw new Error(`bad mask ${JSON.stringify(mask)}: x, y, w and h must be positive numbers`);
    }
    const tag = `v${index}`;
    if (mask.mode === "solid") {
      const color =
        typeof mask.color === "string" ? mask.color.replace(/[^a-zA-Z0-9@#.]/g, "") : "black";
      parts.push(`[${input}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}@1:t=fill[${tag}]`);
    } else {
      parts.push(`[${input}]split=2[base${index}][crop${index}]`);
      parts.push(`[crop${index}]crop=${w}:${h}:${x}:${y},boxblur=${radius}[blur${index}]`);
      parts.push(`[base${index}][blur${index}]overlay=${x}:${y}[${tag}]`);
    }
    input = tag;
    output = tag;
  });
  return { filter: parts.join(";"), output };
}

function maskFrame(source, target, masks) {
  const { width, height } = imageSize(source);
  for (const mask of masks) {
    if (mask.x < 0 || mask.y < 0 || mask.x + mask.w > width || mask.y + mask.h > height) {
      console.warn(
        `warn   ${path.basename(source)}: mask ${JSON.stringify(mask)} is outside ${width}x${height}`,
      );
    }
  }
  const { filter, output } = filterFor(masks);
  const temporary = `${target}.tmp.png`;
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-filter_complex",
      filter,
      "-map",
      `[${output}]`,
      "-frames:v",
      "1",
      temporary,
    ],
    { stdio: "inherit" },
  );
  rmSync(target, { force: true });
  renameSync(temporary, target);
}

if (check) {
  if (!existsSync(outDir)) {
    console.error(`error: ${outDir} does not exist — run without --check first`);
    process.exit(1);
  }
  try {
    execFileSync("tesseract", ["--version"], { stdio: "ignore" });
  } catch {
    console.error(
      "error: tesseract not found; install it (nix shell nixpkgs#tesseract) or skip --check",
    );
    process.exit(1);
  }

  const patterns = [
    { label: "email", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi },
    { label: "phone", regex: /\+?\d[\d ()-]{7,}\d/g },
    { label: "card-like number", regex: /\b(?:\d[ -]?){13,19}\b/g },
    {
      label: "api key",
      regex:
        /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    },
    { label: "private key", regex: /BEGIN [A-Z ]*PRIVATE KEY/g },
  ];

  const frames = readdirSync(outDir)
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (frames.length === 0) {
    console.error(`error: no masked frames in ${outDir} — run mask.mjs without --check first`);
    process.exit(1);
  }
  const debug = flag("--debug");
  const hits = [];
  for (const name of frames) {
    const text = execFileSync("tesseract", [path.join(outDir, name), "stdout"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const pattern of patterns) {
      const matches = text.match(pattern.regex) ?? [];
      if (debug) console.log(`debug  ${name}: ${pattern.label} -> ${JSON.stringify(matches)}`);
      for (const match of matches) {
        // A phone-shaped run is only interesting if it has enough digits for a
        // real number; this keeps dates and short figures out of the report.
        if (pattern.label === "phone") {
          const digits = match.replace(/\D/g, "");
          if (digits.length < 9 || digits.length > 15) continue;
        }
        hits.push({ frame: name, label: pattern.label, match });
      }
    }
  }

  if (hits.length === 0) {
    console.log(`clean  ${frames.length} frames, no PII patterns found by OCR`);
    process.exit(0);
  }
  for (const hit of hits) {
    console.log(`LEAK   ${hit.frame}: ${hit.label}: ${hit.match}`);
  }
  console.log(`\n${hits.length} hit(s). Add masks to the matching shot in shots.json and rerun.`);
  process.exit(warnOnly ? 0 : 1);
}

mkdirSync(frameDir, { recursive: true });
if (path.resolve(outDir) !== path.resolve(frameDir)) {
  mkdirSync(outDir, { recursive: true });
}

const frames = readdirSync(frameDir)
  .filter((name) => name.endsWith(".png"))
  .sort();
if (frames.length === 0) {
  console.error(`error: no PNG frames in ${frameDir}; capture or build the cards first`);
  process.exit(1);
}

let masked = 0;
for (const name of frames) {
  const id = path.basename(name, ".png");
  const source = path.join(frameDir, name);
  const target = path.join(outDir, name);
  if (path.resolve(source) === path.resolve(target)) {
    console.error("error: --out must differ from --frames (raw captures are kept unmasked)");
    process.exit(1);
  }
  const masks = byId.get(id)?.masks ?? [];
  if (masks.length === 0) {
    copyFileSync(source, target);
    continue;
  }
  maskFrame(source, target, masks);
  masked += 1;
  console.log(`mask   ${name} (${masks.length} region${masks.length === 1 ? "" : "s"})`);
}

console.log(`\n${frames.length} frames in ${outDir}; ${masked} masked`);
