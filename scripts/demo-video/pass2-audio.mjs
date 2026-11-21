#!/usr/bin/env node
/**
 * Pass 2: narration -> audio -> muxed video.
 *
 *   node scripts/demo-video/pass2-audio.mjs [--video FILE] [--out DIR]
 *        [--engine auto|piper|espeak] [--download-voice] [--music FILE] [--trim]
 *
 * One voice clip per shot, each padded (never stretched) to its slot in
 * shots.json, concatenated to the full runtime, normalised to -16 LUFS, then
 * muxed onto pass 1's silent video. The SRT from pass 1 is attached as a soft
 * subtitle track as well as being burned in.
 *
 * Piper is the default voice; the model is not vendored. --download-voice
 * fetches en_US-lessac-medium from the piper-voices repository. Without a
 * model the script falls back to espeak-ng, which is intelligible but not
 * submission quality; it says so.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const shotsPath = path.resolve(value("--shots", path.join(here, "shots.json")));
const project = JSON.parse(readFileSync(shotsPath, "utf8"));
const shots = project.shots;
const outDir = path.resolve(value("--out", path.join(here, "out")));
const workDir = path.join(outDir, "work");
const ttsDir = path.join(workDir, "tts");
const video = path.resolve(value("--video", path.join(outDir, "video-silent.mp4")));
const captions = path.resolve(value("--captions", path.join(outDir, "captions.srt")));
const music = value("--music", "");
const trim = flag("--trim");
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const ffprobe = process.env.FFPROBE || "ffprobe";
const voice = value("--voice", process.env.PIPER_VOICE || "en_US-lessac-medium");
const model = path.resolve(
  value("--model", process.env.PIPER_MODEL || path.join(here, "models", `${voice}.onnx`)),
);

if (!existsSync(video)) {
  console.error(`error: ${video} not found — run pass1-video.mjs first`);
  process.exit(1);
}
if (!existsSync(captions)) {
  console.error(`error: ${captions} not found — run pass1-video.mjs first`);
  process.exit(1);
}

mkdirSync(ttsDir, { recursive: true });

const voiceUrl = (() => {
  const [language, region, name, quality] = voice.split("-");
  return `https://huggingface.co/rhasspy/piper-voices/resolve/main/${language}/${language}_${region}/${name}/${quality}/${voice}`;
})();

if (flag("--download-voice")) {
  mkdirSync(path.dirname(model), { recursive: true });
  for (const suffix of [".onnx", ".onnx.json"]) {
    const target = `${model}${suffix === ".onnx" ? "" : ".json"}`;
    if (existsSync(target)) continue;
    console.log(`fetch  ${voiceUrl}${suffix}`);
    execFileSync(
      "curl",
      ["-fL", "--retry", "3", "--create-dirs", "-o", target, `${voiceUrl}${suffix}`],
      {
        stdio: "inherit",
      },
    );
  }
}

function has(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let engine = value("--engine", "auto");
if (engine === "auto") {
  engine = existsSync(model) ? "piper" : "espeak";
}
if (engine === "piper") {
  if (!existsSync(model)) {
    console.error(`error: piper model not found at ${model}`);
    console.error("       run with --download-voice, or --engine espeak for a rough draft");
    process.exit(1);
  }
  if (!has("piper")) {
    console.error("error: piper not on PATH (nix shell nixpkgs#piper-tts)");
    process.exit(1);
  }
} else if (engine !== "espeak") {
  console.error(`error: unknown engine ${engine}; use auto, piper or espeak`);
  process.exit(1);
} else {
  if (!existsSync(model)) {
    console.warn("warn   no piper model; using espeak-ng — fine for timing, not for submission");
  }
  if (!has("espeak-ng")) {
    console.error("error: espeak-ng not on PATH (nix shell nixpkgs#espeak-ng)");
    process.exit(1);
  }
}

const duration = (file) =>
  Number(
    execFileSync(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      {
        encoding: "utf8",
      },
    ).trim(),
  );

function speak(text, file) {
  if (engine === "piper") {
    execFileSync("piper", ["--model", model, "--output_file", file], {
      input: `${text}\n`,
      stdio: ["pipe", "ignore", "inherit"],
    });
  } else {
    execFileSync("espeak-ng", ["-v", "en-gb", "-s", "160", "-w", file, text], { stdio: "inherit" });
  }
}

const overruns = [];
for (const shot of shots) {
  const raw = path.join(ttsDir, `${shot.id}.raw.wav`);
  if (shot.narration?.trim()) {
    speak(shot.narration, raw);
  } else {
    execFileSync(ffmpeg, [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      String(shot.duration),
      raw,
    ]);
  }

  const spoken = duration(raw);
  if (spoken > shot.duration + 0.15) {
    overruns.push({ id: shot.id, spoken, slot: shot.duration });
  }

  const fitted = path.join(ttsDir, `${shot.id}.wav`);
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      raw,
      "-af",
      "apad",
      "-t",
      String(shot.duration),
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      fitted,
    ],
    { stdio: "inherit" },
  );
}

if (overruns.length > 0 && !trim) {
  console.error("\nerror: narration does not fit its slot:");
  for (const overrun of overruns) {
    console.error(
      `  ${overrun.id}: ${overrun.spoken.toFixed(1)}s of speech in a ${overrun.slot}s slot (+${(
        overrun.spoken - overrun.slot
      ).toFixed(1)}s)`,
    );
  }
  console.error("\nTrim words in shots.json, lengthen the shot, or pass --trim to cut the ends.");
  process.exit(1);
}

writeFileSync(
  path.join(ttsDir, "concat.txt"),
  `${shots.map((shot) => `file '${shot.id}.wav'`).join("\n")}\n`,
);
const narration = path.join(outDir, "narration.wav");
execFileSync(
  ffmpeg,
  [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat.txt",
    "-c",
    "copy",
    narration,
  ],
  { cwd: ttsDir, stdio: "inherit" },
);

const audio = path.join(outDir, "audio.wav");
const normalise = "loudnorm=I=-16:TP=-1.5:LRA=11";
if (music) {
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      narration,
      "-stream_loop",
      "-1",
      "-i",
      music,
      "-filter_complex",
      `[1:a]volume=0.07[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0,${normalise}[a]`,
      "-map",
      "[a]",
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      audio,
    ],
    { stdio: "inherit" },
  );
} else {
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      narration,
      "-af",
      normalise,
      "-ar",
      "48000",
      "-c:a",
      "pcm_s16le",
      audio,
    ],
    { stdio: "inherit" },
  );
}

const final = path.join(outDir, "demo.mp4");
execFileSync(
  ffmpeg,
  [
    "-y",
    "-loglevel",
    "error",
    "-i",
    video,
    "-i",
    audio,
    "-i",
    captions,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:s",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-c:s",
    "mov_text",
    "-metadata:s:s:0",
    "language=eng",
    "-movflags",
    "+faststart",
    final,
  ],
  { stdio: "inherit" },
);

const videoSeconds = duration(video);
const finalSeconds = duration(final);
console.log(`\nwrote ${path.relative(process.cwd(), final)} — ${finalSeconds.toFixed(1)}s`);
console.log(`voice  ${engine}${engine === "piper" ? ` (${path.basename(model)})` : ""}`);
if (Math.abs(finalSeconds - videoSeconds) > 0.25) {
  console.warn(
    `warn   final duration ${finalSeconds.toFixed(1)}s differs from the silent cut ${videoSeconds.toFixed(1)}s`,
  );
}
