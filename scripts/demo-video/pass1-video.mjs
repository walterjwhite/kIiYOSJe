#!/usr/bin/env node
/**
 * Pass 1: frames -> silent video + captions.
 *
 *   node scripts/demo-video/pass1-video.mjs [--frames DIR] [--out DIR] [--no-burn]
 *
 * Input is one PNG per shot in shots.json, named <shot id>.png, normally in
 * frames/masked/ (the output of mask.mjs). Output:
 *
 *   out/video-silent.mp4   H.264, 30 fps, captions burned in
 *   out/captions.srt       the same captions as a sidecar
 *   out/manifest.json      shot start times, for pass 2
 *
 * Pass 1 never touches audio: pass 2 adds it. A missing frame fails the run
 * unless --allow-missing is given, which inserts a plain slate so an early
 * draft cut can still be reviewed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const shotsPath = path.resolve(value("--shots", path.join(here, "shots.json")));
const frameDir = path.resolve(value("--frames", path.join(here, "frames", "masked")));
const outDir = path.resolve(value("--out", path.join(here, "out")));
const workDir = path.join(outDir, "work");
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const allowMissing = flag("--allow-missing");
const burn = !flag("--no-burn");

const project = JSON.parse(readFileSync(shotsPath, "utf8"));
const { fps, width, height } = project;
const shots = project.shots;

mkdirSync(workDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const missing = shots.filter((shot) => !existsSync(path.join(frameDir, `${shot.id}.png`)));
if (missing.length > 0 && !allowMissing) {
  console.error("error: missing frames:");
  for (const shot of missing) console.error(`  ${shot.id}.png`);
  console.error(
    `\nExpected in ${frameDir}. Capture them, render the cards, or pass --allow-missing.`,
  );
  process.exit(1);
}
for (const shot of missing) {
  console.warn(`warn   ${shot.id}: no frame, inserting a slate (do not submit this cut)`);
}

const pad = "color=0x0d0f13";
const scale = [
  `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
  `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${pad}`,
  "setsar=1",
  "format=yuv420p",
].join(",");

const encode = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(fps),
];

for (const shot of shots) {
  const frame = path.join(frameDir, `${shot.id}.png`);
  const clip = path.join(workDir, `${shot.id}.mp4`);
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (existsSync(frame)) {
    args.push(
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-i",
      frame,
      "-t",
      String(shot.duration),
      "-vf",
      scale,
    );
  } else {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0d0f13:s=${width}x${height}:r=${fps}`,
      "-t",
      String(shot.duration),
    );
  }
  args.push(...encode, clip);
  execFileSync(ffmpeg, args, { stdio: "inherit" });
}

writeFileSync(
  path.join(workDir, "concat.txt"),
  `${shots.map((shot) => `file '${shot.id}.mp4'`).join("\n")}\n`,
);
const silent = path.join(outDir, "video-silent.mp4");
execFileSync(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat.txt",
    "-c",
    "copy",
    silent,
  ],
  { cwd: workDir, stdio: "inherit" },
);

const srtTime = (seconds) => {
  const ms = Math.round(seconds * 1000);
  const hh = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, "0")}`;
};

const cues = [];
let start = 0;
const manifest = [];
for (const shot of shots) {
  manifest.push({ id: shot.id, start, duration: shot.duration });
  if (shot.caption) {
    const cueStart = start + 0.2;
    const cueEnd = start + Math.max(2, shot.duration - 0.4);
    cues.push({ start: cueStart, end: cueEnd, text: shot.caption });
  }
  start += shot.duration;
}
const srt = cues
  .map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`)
  .join("\n");
writeFileSync(path.join(outDir, "captions.srt"), srt);

if (burn) {
  const burned = path.join(outDir, "video-burned.mp4");
  const style = [
    "FontName=DejaVu Sans",
    "FontSize=26",
    "PrimaryColour=&H00F5F7FA",
    "OutlineColour=&HA0000000",
    "BorderStyle=3",
    "Outline=1",
    "Shadow=0",
    "MarginV=42",
    "Alignment=2",
  ].join(",");
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      "video-silent.mp4",
      "-vf",
      `subtitles=captions.srt:force_style='${style}'`,
      "-an",
      ...encode,
      burned,
    ],
    { cwd: outDir, stdio: "inherit" },
  );
  rmSync(silent, { force: true });
  renameSync(burned, silent);
}

writeFileSync(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify({ fps, width, height, totalSeconds: start, shots: manifest }, null, 2)}\n`,
);

const minutes = Math.floor(start / 60);
const seconds = String(Math.round(start % 60)).padStart(2, "0");
console.log(
  `\nwrote ${path.relative(process.cwd(), silent)} — ${minutes}:${seconds}, ${width}x${height}, ${fps} fps`,
);
console.log(`wrote ${path.relative(process.cwd(), path.join(outDir, "captions.srt"))}`);
