#!/usr/bin/env bash
#
# Build the demo video from real captures in one command.
#
#   ./scripts/demo-video/make-demo-video.sh
#
# Steps: verify the toolchain, seed demo.db if it is missing, start the demo
# server (or refuse if something is already on 8787), build the extension and
# cards, capture VS Code (and Android when a device is attached), mask, run the
# PII gate, pass 1 and pass 2.
#
# The tools are not on PATH by default. On this workstation the dotfiles install
# `demo-video-env`; the script re-execs through it automatically. Elsewhere:
# nix-shell scripts/demo-video/shell.nix.
#
# Options:
#   --seed                    reseed demo.db even if it exists (slow: real AI calls)
#   --skip-seed               use an empty/existing demo DB without seeding
#   --use-running-server      use the server already on 8787; only after you have
#                             confirmed it serves the demo database
#   --skip-vscode             reuse frames/ instead of capturing VS Code again
#   --skip-android            do not look for an adb device
#   --skip-build              reuse the existing .vsix and dist/ build
#   --no-audio                stop after the silent pass-1 cut
#   --espeak                  force the rough espeak voice (no piper download)
#   --no-trim                 fail rather than cut narration that overruns its slot
#   --music FILE              mix music under the narration
#   --strict                  fail on missing frames instead of inserting slates
#   --force                   overwrite existing frames (manual 05/06 included)
#   --xvfb                    capture inside Xvfb (automatic with no DISPLAY)
#   --dry-run                 print the plan and exit
#   -h, --help
#
# Output: <repo-root>/out/demo.mp4 (out/ is git-ignored)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out"
FRAMES="$HERE/frames"
DEMO_DB="${MIND_DEMO_DB:-$HOME/.data/kIiYOSJe/mind/demo.db}"
TOKEN_FILE="${MIND_TOKEN_FILE:-$HOME/.config/kIiYOSJe/mind/token}"
SERVER_URL="${MIND_SERVER_URL:-http://127.0.0.1:8787}"

SEED=0
SKIP_SEED=0
USE_RUNNING=0
SKIP_VSCODE=0
SKIP_ANDROID=0
SKIP_BUILD=0
NO_AUDIO=0
ENGINE=""
TRIM=1
MUSIC=""
STRICT=0
FORCE=0
XVFB=0
DRY=0
SERVER_PID=""
STARTED_SERVER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed) SEED=1; shift ;;
    --skip-seed) SKIP_SEED=1; shift ;;
    --use-running-server) USE_RUNNING=1; shift ;;
    --skip-vscode) SKIP_VSCODE=1; shift ;;
    --skip-android) SKIP_ANDROID=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-audio) NO_AUDIO=1; shift ;;
    --espeak) ENGINE="espeak"; shift ;;
    --no-trim) TRIM=0; shift ;;
    --music) MUSIC="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    --force) FORCE=1; shift ;;
    --xvfb) XVFB=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

cd "$ROOT"

# The .vsix embeds the compiled packages and the extension, so it stays usable
# only while no source behind it is newer. Rebuilding costs about a minute;
# trusting a stale .vsix would put the previous code in the video.
extension_sources_newer_than_vsix() {
  local newer
  newer="$(find "$ROOT/extension/src" "$ROOT/extension/media" \
    "$ROOT/extension/package.json" "$ROOT/extension/tsconfig.json" \
    "$ROOT/packages" "$ROOT/scripts/build-extension.sh" \
    -type f -newer "$1" \
    -not -path '*/node_modules/*' -not -path '*/dist/*' \
    -not -name 'tsconfig.tsbuildinfo' -print -quit 2>/dev/null || true)"
  [[ -n "$newer" ]]
}

if [[ "$SEED" == "1" && "$SKIP_SEED" == "1" ]]; then
  echo "error: --seed and --skip-seed conflict" >&2
  exit 2
fi
if [[ "$SEED" == "1" && "$USE_RUNNING" == "1" ]]; then
  echo "error: --seed needs the server stopped; it cannot reseed under --use-running-server" >&2
  exit 2
fi

if [[ "$DRY" == "1" ]]; then
  echo "plan:"
  echo "  1. seed $DEMO_DB if missing (or --seed to force)"
  echo "  2. start npm run demo:serve on $SERVER_URL; refuse if it is already serving"
  echo "  3. build the extension if its .vsix is stale, and render the cards"
  echo "  4. capture VS Code$( [[ "$SKIP_VSCODE" == 1 ]] && echo ' (skipped)' )"
  echo "  5. capture Android if adb shows a device$( [[ "$SKIP_ANDROID" == 1 ]] && echo ' (skipped)' )"
  echo "  6. mask + PII gate"
  echo "  7. pass 1 (silent)$( [[ "$STRICT" == 1 ]] && echo ', strict' || echo ', slates allowed' )"
  echo "  8. pass 2 (audio)$( [[ "$NO_AUDIO" == 1 ]] && echo ' (skipped)' )"
  echo "  output: $OUT/demo.mp4"
  vsix="$(ls -t "$ROOT"/extension/*.vsix 2>/dev/null | head -n1 || true)"
  if [[ "$SKIP_BUILD" == "1" ]]; then
    echo "  build: skipped (--skip-build); needs $(basename "${vsix:-a .vsix}")"
  elif [[ -z "$vsix" ]]; then
    echo "  build: no .vsix yet, so the extension will be built"
  elif extension_sources_newer_than_vsix "$vsix"; then
    echo "  build: the extension sources are newer than $(basename "$vsix"); it will be rebuilt"
  else
    echo "  build: $(basename "$vsix") is current; the rebuild will be skipped"
  fi
  exit 0
fi

# Re-exec through the dotfiles wrapper when the tools are not on PATH.
if [[ "${MIND_DEMO_REEXEC:-0}" != "1" ]]; then
  needed=(node npm ffmpeg ffprobe tesseract chromium)
  if [[ "$SKIP_VSCODE" == "0" ]]; then
    needed+=(xdotool maim)
    if [[ "$XVFB" == "1" || -z "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
      needed+=(Xvfb openbox)
    fi
  fi
  missing=""
  for tool in "${needed[@]}"; do
    command -v "$tool" >/dev/null || missing="$missing $tool"
  done
  if [[ -n "$missing" ]]; then
    if command -v demo-video-env >/dev/null; then
      MIND_DEMO_REEXEC=1 exec demo-video-env "$0" "$@"
    fi
    echo "error: missing tools:$missing" >&2
    echo "run 'demo-video-env $0' on this workstation, or enter nix-shell scripts/demo-video/shell.nix" >&2
    exit 1
  fi
fi

command -v chromium >/dev/null || echo "warn: chromium not on PATH; build-cards.mjs will fail" >&2

auth=()
token="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
if [[ -n "$token" ]]; then auth=(-H "Authorization: Bearer $token"); fi

server_status() {
  curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" "$SERVER_URL/health" 2>/dev/null || true
}

cleanup() {
  if [[ "$STARTED_SERVER" == "1" && -n "$SERVER_PID" ]]; then
    kill -- -"$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

status="$(server_status)"
if [[ "$status" == "000" ]]; then
  if [[ "$USE_RUNNING" == "1" ]]; then
    echo "error: --use-running-server was given, but nothing answers on $SERVER_URL" >&2
    exit 1
  fi
else
  if [[ "$status" == "200" ]]; then
    if [[ "$USE_RUNNING" != "1" ]]; then
      echo "refusing: something is already serving $SERVER_URL." >&2
      echo "That may be the real database. Stop it, or pass --use-running-server" >&2
      echo "after confirming the Queue shows the synthetic demo personas." >&2
      exit 1
    fi
    echo "==> using the server already on $SERVER_URL (assumed demo)"
    echo "    you are asserting that Queue shows synthetic personas; the PII gate is not a substitute" >&2
  else
    echo "error: $SERVER_URL answered HTTP $status instead of 200." >&2
    echo "The token at $TOKEN_FILE may belong to a different server. Stop it and retry." >&2
    exit 1
  fi
fi

if [[ "$USE_RUNNING" == "0" ]]; then
  if [[ -f "$DEMO_DB" && "$SEED" == "0" ]]; then
    echo "==> demo.db exists; keeping it (pass --seed to rebuild)"
  elif [[ "$SKIP_SEED" == "1" ]]; then
    echo "warn: --skip-seed with no demo.db; the Queue will be empty" >&2
  else
    echo "==> seeding demo.db (real model calls; 20-40 minutes is normal)"
    npm run demo:seed
  fi
fi

if [[ "$USE_RUNNING" == "0" ]]; then
  mkdir -p "$OUT"
  echo "==> starting npm run demo:serve"
  if [[ "$SKIP_ANDROID" == "0" ]] && command -v adb >/dev/null &&
    adb devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit !found }'; then
    setsid env MIND_BIND_HOST=0.0.0.0 npm run demo:serve >"$OUT/server.log" 2>&1 &
    echo "    bound to 0.0.0.0 so the emulator can reach it"
  else
    setsid npm run demo:serve >"$OUT/server.log" 2>&1 &
  fi
  SERVER_PID=$!
  STARTED_SERVER=1

  for _ in $(seq 1 60); do
    token="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
    if [[ -n "$token" ]]; then auth=(-H "Authorization: Bearer $token"); fi
    status="$(server_status)"
    [[ "$status" == "200" ]] && break
    sleep 1
  done
  if [[ "$status" != "200" ]]; then
    echo "error: demo server did not become healthy (HTTP $status)" >&2
    tail -n 30 "$OUT/server.log" >&2 || true
    exit 1
  fi
fi

[[ -f "$TOKEN_FILE" ]] || { echo "error: no operator token at $TOKEN_FILE" >&2; exit 1; }

vsix="$(ls -t "$ROOT"/extension/*.vsix 2>/dev/null | head -n1 || true)"
if [[ "$SKIP_BUILD" == "0" ]]; then
  if [[ -n "$vsix" ]] && ! extension_sources_newer_than_vsix "$vsix"; then
    echo "==> $(basename "$vsix") is newer than the extension sources; keeping it"
  else
    echo "==> building the extension"
    bash scripts/build-extension.sh --no-install
  fi
else
  [[ -n "$vsix" ]] || {
    echo "error: --skip-build but no .vsix exists" >&2
    exit 1
  }
fi

echo "==> rendering the cards"
node "$HERE/build-cards.mjs"

if [[ "$SKIP_VSCODE" == "0" ]]; then
  capture_args=(--install)
  if [[ "$XVFB" == "1" || -z "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    capture_args+=(--xvfb)
  fi
  if [[ "$FORCE" == "1" ]]; then capture_args+=(--force); fi
  echo "==> capturing VS Code"
  MIND_CAPTURE_CONFIRM=demo MIND_SERVER_URL="$SERVER_URL" \
    bash "$HERE/capture-vscode.sh" "${capture_args[@]}"
else
  echo "==> reusing existing frames (--skip-vscode)"
fi

ANDROID_READY=0
if [[ "$SKIP_ANDROID" == "0" ]] && command -v adb >/dev/null &&
  adb devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { found = 1 } END { exit !found }'; then
  ANDROID_READY=1
fi

if [[ "$ANDROID_READY" == "1" ]]; then
  echo "==> capturing Android"
  android_args=(--api "$SERVER_URL" --server-url "http://10.0.2.2:8787")
  if [[ "$FORCE" == "1" ]]; then android_args+=(--force); fi
  bash "$HERE/capture-android.sh" "${android_args[@]}"
else
  echo "==> no adb device; Android beats will be slates"
fi

echo "==> masking"
node "$HERE/mask.mjs"

echo "==> PII gate"
node "$HERE/mask.mjs" --check

missing="$(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const shots = JSON.parse(fs.readFileSync("scripts/demo-video/shots.json", "utf8")).shots;
  const dir = "scripts/demo-video/frames/masked";
  console.log(shots.filter((s) => !fs.existsSync(path.join(dir, `${s.id}.png`))).map((s) => s.id).join(" "));
')"

if [[ -n "$missing" ]]; then
  if [[ "$STRICT" == "1" ]]; then
    echo "error: missing frames (--strict): $missing" >&2
    exit 1
  fi
  echo "warn: slating missing frames: $missing"
fi

echo "==> pass 1 (silent)"
pass1_args=()
if [[ -n "$missing" ]]; then pass1_args+=(--allow-missing); fi
node "$HERE/pass1-video.mjs" "${pass1_args[@]}"

if [[ "$NO_AUDIO" == "0" ]]; then
  echo "==> pass 2 (audio)"
  pass2_args=()
  if [[ "$TRIM" == "1" ]]; then pass2_args+=(--trim); fi
  if [[ -n "$MUSIC" ]]; then pass2_args+=(--music "$MUSIC"); fi
  if [[ "$ENGINE" == "espeak" ]]; then
    pass2_args+=(--engine espeak)
  elif command -v piper >/dev/null; then
    pass2_args+=(--download-voice)
  fi
  node "$HERE/pass2-audio.mjs" "${pass2_args[@]}"
fi

echo
if [[ -f "$OUT/demo.mp4" ]]; then
  ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,codec_type \
    -of default=nw=1 "$OUT/demo.mp4"
  echo "wrote $OUT/demo.mp4"
else
  echo "wrote $OUT/video-silent.mp4 (--no-audio)"
fi
if [[ -n "$missing" ]]; then
  echo "DRAFT: slates were inserted for: $missing"
  echo "Capture 05-details and 06-approve by hand, then rerun without --strict." >&2
fi
