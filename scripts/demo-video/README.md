# Demo video pipeline

Produces the submission video from **real screenshots** of the running app:
pass 1 assembles a silent, captioned video; pass 2 adds the voiceover and muxes
it. Nothing about the UI is redrawn — the only non-screenshot frames are the
two typographic cards (`title`, `overview`), rendered from HTML.

It is deliberately dependency-free on the Node side: JSON parsing, filtering
and process orchestration use Node 24 built-ins, and every media operation is
ffmpeg. No npm package is added.

## What it needs

| Tool | Used for |
| --- | --- |
| `ffmpeg` / `ffprobe` | masking, assembly, probing, audio mix, mux |
| `chromium` | rendering the two cards to PNG |
| `tesseract` | the OCR gate that fails on leaked PII |
| `espeak-ng` | fallback voice (rough; for timing only) |
| `piper-tts` | the submission voice (large closure, ~1.8 GiB) |
| `xdotool`, `maim`, `Xvfb`, `openbox` | real VS Code captures; `--xvfb` for headless |
| `android-tools` (`adb`) | real Android captures |
| `dejavu_fonts` | subtitle/card fonts |

On NixOS:

```bash
nix-shell scripts/demo-video/shell.nix
```

or, without the shell file:

```bash
nix shell nixpkgs#ffmpeg nixpkgs#chromium nixpkgs#tesseract nixpkgs#espeak-ng \
  nixpkgs#xdotool nixpkgs#maim nixpkgs#xvfb nixpkgs#openbox \
  nixpkgs#dejavu_fonts nixpkgs#android-tools
nix shell nixpkgs#piper-tts        # optional, large
```

The Android emulator is not packaged in `shell.nix`. Install Android Studio or
the SDK command-line tools (`sdkmanager`, `emulator`, `avdmanager`), create an
`android-35` x86_64 AVD, and make sure `/dev/kvm` is readable. On NixOS add
your user to the `kvm` group and log back in:

```nix
users.users.<you>.extraGroups = [ "kvm" ];
```

## Quick start

```bash
npm run demo:seed                 # synthetic signals through the real pipeline
npm run demo:serve                # http://127.0.0.1:8787, demo.db

bash scripts/build-extension.sh
node scripts/demo-video/build-cards.mjs          # 01-title, 02-overview

MIND_CAPTURE_CONFIRM=demo bash scripts/demo-video/capture-vscode.sh --install
# or: MIND_CAPTURE_CONFIRM=demo bash scripts/demo-video/capture-vscode.sh --install --xvfb

bash scripts/demo-video/capture-android.sh --reset             # emulator/phone

node scripts/demo-video/mask.mjs                 # frames/ -> frames/masked/
node scripts/demo-video/mask.mjs --check         # OCR gate

node scripts/demo-video/pass1-video.mjs          # silent video + captions.srt
node scripts/demo-video/pass2-audio.mjs --download-voice
```

## One command

On this workstation the dotfiles install `demo-video-env` (see
`~/.data/configuration/modules/demo-video.nix`), which carries the ffmpeg,
Chromium, Piper, Xvfb and Android tools. Elsewhere use `nix-shell
scripts/demo-video/shell.nix`. Then:

```bash
./scripts/demo-video/make-demo-video.sh
```

It seeds `demo.db` if missing, starts the demo server itself, rebuilds the
extension only when its `.vsix` is older than the sources behind it, renders the
cards, captures VS Code (and Android when a device is attached),
mask + PII gate, then both passes. It **refuses** if something already listens
on 8787, because that may be the real database; stop it, or pass
`--use-running-server` after checking the Queue. Missing manual beats become
slates unless `--strict`, and the run ends with a `DRAFT` line. `--help` lists
the rest (`--skip-android`, `--no-audio`, `--espeak`, `--music`, `--dry-run`).

Output: `<repo-root>/out/demo.mp4` (H.264/AAC, captions burned in and attached
as a soft subtitle track), `<repo-root>/out/captions.srt`,
`<repo-root>/out/manifest.json`. The root `out/` directory is git-ignored.

The capture scripts record whatever is running on the server they are pointed
at, and `127.0.0.1:8787` is just as likely to be a real instance as the demo
one. The VS Code script refuses to run unless `MIND_CAPTURE_CONFIRM=demo` is
set; start `npm run demo:serve` and check the Queue shows the synthetic
personas before confirming. The mask check is a backstop, not permission to
record real mail.

`shots.json` is the single source of truth: ids, durations, captions,
narration and masks. Both passes read it, so changing a duration changes the
video and the voiceover slot together.

### Manual beats

The command palette gets the panel-level shots. Two beats need a real click
inside a webview, so capture them by hand into `frames/` with those names:

- `05-details` — open a queue item's Details/Transcript
- `06-approve` — show the Approve action on a drafted reply

Existing frames are never overwritten without `--force`, so hand-picked
screenshots survive a rerun of the capture script. A draft cut can be made
before they exist with `--allow-missing`; it inserts a plain slate for each
gap and is labelled not-for-submission. The nightly job uses that mode.

## Masking and PII

Masks live on the shot, in source-pixel coordinates:

```json
{
  "id": "04-queue",
  "masks": [
    { "x": 40, "y": 120, "w": 420, "h": 30 },
    { "x": 40, "y": 160, "w": 420, "h": 30, "mode": "solid" }
  ]
}
```

Blur is the default (radius 18, `--radius` to change). `solid` paints black.
Cover the whole value plus a margin — a mask that clips the last characters
still leaks a fragment. Raw captures in `frames/` are never modified; the
masked copies in `frames/masked/` are what pass 1 uses.

`mask.mjs --check` OCRs every masked frame and exits non-zero on anything that
still looks like an email, phone number, card number, API key or private key.
It is a safety net, not a proof: OCR can miss low-contrast text, so review the
frames as well. `--debug` prints what OCR matched.

## Nightly CI

`scripts/demo-video/nightly.yml` is a complete draft workflow: Ollama model,
demo seed, VS Code capture under Xvfb, emulator capture, masking gate, both
passes, artifact upload.

It is **not active**, and deliberately not under `.github/workflows/`:
`AGENTS.md` makes `.github/` a hard-limit area that needs an issue labelled
`human-approved-scope`. Move it yourself once that approval exists, and pin the
actions to commit SHAs if `security.yml` requires it.

What the nightly job can and cannot do:

- It downloads `qwen2.5:3b-instruct` and seeds with real model calls; expect
  20–40 minutes, not three.
- It slates `05-details` and `06-approve` (no stable selector for a click in a
  webview). The artifact is a review draft; add those two frames by hand for a
  submission.
- The Android emulator needs `/dev/kvm`; GitHub's Ubuntu runners provide it.
- It uploads the video as an artifact, never commits it.

## Checks run when this was built

- Cards rendered by Chromium at 1920×1080; pass 1 produced a 3:05, 1080p30
  H.264 cut with burned captions.
- Pass 2 (espeak fallback, `--trim`) produced a 185.0 s file with H.264 video,
  stereo AAC and a `mov_text` subtitle stream.
- Mask gate: a frame with a planted email and phone was flagged (2 hits);
  after two blur regions it passed clean. A phone pattern bug and an unmapped
  filtergraph output were found and fixed this way.
- VS Code capture: the extension installs, the window is found, the command
  palette opens and the Queue panel is captured under Xvfb. A reused profile
  caused silent forwarding to a stale instance, so the script uses a fresh
  profile per run. Capturing against the live server instead of the demo one
  is what added the confirmation gate above.

Not verified here: Android capture against an emulator (none installed on this
machine), and a full submission cut with real demo data. The Android script is
syntax-checked only; treat the first run as a shakedown and report what breaks.
