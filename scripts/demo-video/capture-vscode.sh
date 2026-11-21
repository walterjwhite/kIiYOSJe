#!/usr/bin/env bash
#
# Capture real VS Code screenshots for the demo video.
#
#   ./capture-vscode.sh --install          # install the built .vsix into a throwaway profile
#   ./capture-vscode.sh --install --xvfb   # same, inside Xvfb (CI, or no X11 session)
#
# It drives the command palette with xdotool and captures the active window
# with maim (or ffmpeg x11grab). Screenshots land in frames/ as <shot id>.png;
# the ids match shots.json, and pass 1 refuses to run if any are missing.
#
# This covers the command-level screens (sidebar, Queue, Signals, Directions,
# Learnings, Analytics, Devices, close). Detail-level beats that need a specific
# row clicked — 05-details, 06-approve — and every Android shot are left to a
# manual capture or capture-android.sh. Existing PNGs are never overwritten
# unless --force is passed, so a hand-picked frame survives a rerun.
#
# Requirements: X11 (or --xvfb), xdotool, a window manager, maim or ffmpeg.
# The server must be running and the demo database seeded; the extension talks
# to http://127.0.0.1:8787 by default.
#
# Options:
#   --out DIR        screenshot directory (default: scripts/demo-video/frames)
#   --workspace DIR  folder to open in VS Code (default: repo root)
#   --size WxH       window size (default: 1920x1080)
#   --install        install extension/*.vsix into the throwaway profile
#   --xvfb           start a private Xvfb (first free display from :99) + openbox
#   --force          overwrite existing frames
#   --keep-open      leave the VS Code window open when done

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

FRAMES="$HERE/frames"
WORKSPACE="$ROOT"
WIDTH=1920
HEIGHT=1080
INSTALL=0
XVFB=0
FORCE=0
KEEP_OPEN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) FRAMES="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --size) WIDTH="${2%x*}"; HEIGHT="${2#*x}"; shift 2 ;;
    --install) INSTALL=1; shift ;;
    --xvfb) XVFB=1; shift ;;
    --force) FORCE=1; shift ;;
    --keep-open) KEEP_OPEN=1; shift ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in code xdotool; do
  if ! command -v "$tool" >/dev/null; then
    echo "error: $tool not found (nix shell nixpkgs#xvfb nixpkgs#xdotool nixpkgs#maim)" >&2
    exit 1
  fi
done
if ! command -v maim >/dev/null && ! command -v ffmpeg >/dev/null; then
  echo "error: need maim or ffmpeg to capture the window" >&2
  exit 1
fi

PROFILE="$HERE/work/vscode-profile-$$"
EXTENSIONS="$HERE/work/vscode-extensions"
mkdir -p "$FRAMES" "$PROFILE/User" "$EXTENSIONS" "$HERE/work"
# A brand-new profile opens the Copilot sign-in/welcome dialog, which takes
# focus and swallows the command-palette keystrokes. Turn those prompts off.
cat > "$PROFILE/User/settings.json" <<'JSON'
{
  "workbench.startupEditor": "none",
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "chat.disableAIFeatures": true,
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none"
}
JSON

XVFB_PID=""
if [[ "$XVFB" == "1" ]]; then
  for tool in Xvfb openbox; do
    if ! command -v "$tool" >/dev/null; then
      echo "error: --xvfb needs $tool (nix shell nixpkgs#xvfb nixpkgs#openbox)" >&2
      exit 1
    fi
  done
  # Never reuse a display number that something already holds. A run that was
  # killed leaves its Xvfb (and its VS Code windows) behind on :99, so starting
  # Xvfb there fails, and the capture then drives — and screenshots — windows
  # from the old session, which may vanish mid-sequence (X Error: BadWindow).
  display_num="${MIND_DEMO_DISPLAY:-:99}"
  display_num="${display_num#:}"
  [[ "$display_num" =~ ^[0-9]+$ ]] || { echo "error: MIND_DEMO_DISPLAY must be :N, got $display_num" >&2; exit 2; }
  for _ in $(seq 1 20); do
    if [[ ! -e "/tmp/.X${display_num}-lock" && ! -e "/tmp/.X11-unix/X${display_num}" ]]; then
      break
    fi
    display_num=$((display_num + 1))
  done
  export DISPLAY=":${display_num}"
  Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp >"$HERE/work/xvfb.log" 2>&1 &
  XVFB_PID=$!
  ready=0
  for _ in $(seq 1 100); do
    kill -0 "$XVFB_PID" 2>/dev/null || break
    if xdotool getdisplaygeometry >/dev/null 2>&1; then ready=1; break; fi
    sleep 0.1
  done
  if [[ "$ready" != "1" ]]; then
    echo "error: Xvfb did not come up on $DISPLAY (see $HERE/work/xvfb.log)" >&2
    tail -n 5 "$HERE/work/xvfb.log" >&2 || true
    exit 1
  fi
  openbox >/dev/null 2>&1 &
  sleep 0.5
fi

if [[ -z "${DISPLAY:-}" ]]; then
  echo "error: no DISPLAY; rerun with --xvfb or from a desktop session" >&2
  exit 1
fi

TOKEN_FILE="${MIND_TOKEN_FILE:-$HOME/.config/kIiYOSJe/mind/token}"
SERVER_URL="${MIND_SERVER_URL:-http://127.0.0.1:8787}"
if [[ -f "$TOKEN_FILE" ]]; then
  if ! curl -fsS -H "Authorization: Bearer $(cat "$TOKEN_FILE")" "$SERVER_URL/health" >/dev/null 2>&1; then
    echo "warn: $SERVER_URL is not answering; panels will be empty. Start: npm run demo:serve" >&2
  fi
else
  echo "warn: no token at $TOKEN_FILE; is the server running?" >&2
fi

if [[ "${MIND_CAPTURE_CONFIRM:-}" != "demo" ]]; then
  echo "refusing to capture: $SERVER_URL may be a real instance, not the demo database." >&2
  echo "start 'npm run demo:serve', confirm the Queue shows synthetic personas," >&2
  echo "then rerun with MIND_CAPTURE_CONFIRM=demo." >&2
  exit 1
fi

if [[ "$INSTALL" == "1" ]]; then
  VSIX="$(ls -t "$ROOT"/extension/*.vsix 2>/dev/null | head -n1 || true)"
  if [[ -z "$VSIX" ]]; then
    echo "error: no .vsix found; run bash scripts/build-extension.sh first" >&2
    exit 1
  fi
  echo "==> installing $(basename "$VSIX")"
  code --user-data-dir "$PROFILE" --extensions-dir "$EXTENSIONS" \
    --install-extension "$VSIX" --force
fi

echo "==> launching VS Code"
# A fresh profile per run: a reused one can be held by a surviving instance
# (the CLI then forwards to it and exits without opening a window) or by a
# stale singleton lock. The extension lives in the shared EXTENSIONS dir.
ELECTRON_ARGS=()
# xdotool only sees X11 windows. Under --xvfb the display is X11 by
# definition, and an inherited Wayland session makes Electron try Wayland and
# exit before any window exists, so force X11 there too.
if [[ "$XVFB" == "1" || -n "${WAYLAND_DISPLAY:-}" || "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
  unset WAYLAND_DISPLAY XDG_SESSION_TYPE
  ELECTRON_ARGS+=(--ozone-platform=x11)
fi
if [[ "$XVFB" == "1" ]]; then
  ELECTRON_ARGS+=(--disable-gpu)
fi
echo "==> display ${DISPLAY} (${ELECTRON_ARGS[*]:-default})"
# shellcheck disable=SC2086
code --user-data-dir "$PROFILE" --extensions-dir "$EXTENSIONS" \
  "${ELECTRON_ARGS[@]}" \
  --new-window --disable-workspace-trust --skip-welcome --skip-release-notes \
  ${MIND_CAPTURE_NO_SANDBOX:+--no-sandbox} \
  "$WORKSPACE" >"$HERE/work/vscode.log" 2>&1 &
LAUNCH_PID=$!

# Pick the largest visible VS Code window. The search also returns transient and
# child windows, and a fresh profile can replace its first window while the
# workbench loads; the last id in the list is not necessarily the editor.
find_vscode_window() {
  local id geometry w h area best="" best_area=0
  while read -r id; do
    [[ -n "$id" ]] || continue
    geometry="$(xdotool getwindowgeometry --shell "$id" 2>/dev/null)" || continue
    w="$(printf '%s\n' "$geometry" | sed -n 's/^WIDTH=//p')"
    h="$(printf '%s\n' "$geometry" | sed -n 's/^HEIGHT=//p')"
    [[ "$w" =~ ^[0-9]+$ && "$h" =~ ^[0-9]+$ ]] || continue
    area=$((w * h))
    if (( area > best_area )); then
      best="$id"
      best_area="$area"
    fi
  done < <(
    { xdotool search --onlyvisible --class '[Cc]ode' 2>/dev/null || true
      xdotool search --onlyvisible --name 'Visual Studio Code' 2>/dev/null || true
    } | sort -u
  )
  printf '%s' "$best"
}

WAIT="${MIND_CAPTURE_WAIT:-60}"
WID=""
for _ in $(seq 1 "$WAIT"); do
  WID="$(find_vscode_window)"
  [[ -n "$WID" ]] && break
  sleep 1
done
if [[ -z "$WID" ]]; then
  echo "error: no VS Code window appeared after ${WAIT}s (see $HERE/work/vscode.log)" >&2
  echo "--- visible windows on ${DISPLAY}" >&2
  for id in $(xdotool search --onlyvisible --name '.*' 2>/dev/null | tail -n 8); do
    echo "    $id $(xdotool getwindowname "$id" 2>/dev/null)" >&2
  done
  tail -n 20 "$HERE/work/vscode.log" >&2 || true
  echo "hint: on Wayland use --xvfb; in containers also set MIND_CAPTURE_NO_SANDBOX=1" >&2
  exit 1
fi

cleanup() {
  if [[ "$KEEP_OPEN" == "0" ]]; then
    if [[ -n "${WID:-}" ]]; then
      xdotool windowclose "$WID" 2>/dev/null || true
    fi
    rm -rf "$PROFILE" 2>/dev/null || true
  fi
  if [[ -n "$XVFB_PID" ]]; then
    kill "$XVFB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

xdotool windowsize "$WID" "$WIDTH" "$HEIGHT" 2>/dev/null || true
xdotool windowmove "$WID" 0 0 2>/dev/null || true
xdotool windowactivate --sync "$WID" 2>/dev/null || true
sleep 3
# Belt and braces: close any remaining first-run dialog before typing.
xdotool key --clearmodifiers Escape 2>/dev/null || true
sleep 1

window_alive() {
  xdotool getwindowgeometry "$1" >/dev/null 2>&1
}

# Re-resolve and retry: the window can disappear between the search and the
# capture (VS Code replaces it while loading, or it was left by an older run on
# a reused display), which maim reports as BadWindow.
capture_window() {
  local output="$1"
  local temporary="${output%.png}.tmp.png"
  local attempt geometry gx gy
  for attempt in 1 2 3; do
    if ! window_alive "$WID"; then
      WID="$(find_vscode_window)"
      if [[ -z "$WID" ]]; then
        sleep 1
        continue
      fi
      echo "warn: VS Code window changed; capturing $WID instead" >&2
      xdotool windowsize "$WID" "$WIDTH" "$HEIGHT" 2>/dev/null || true
      xdotool windowmove "$WID" 0 0 2>/dev/null || true
      xdotool windowactivate --sync "$WID" 2>/dev/null || true
      sleep "${SETTLE:-1.2}"
    fi
    if command -v maim >/dev/null; then
      if maim -i "$WID" "$temporary" 2>/dev/null; then
        mv "$temporary" "$output"
        return 0
      fi
    else
      geometry="$(xdotool getwindowgeometry --shell "$WID" 2>/dev/null || true)"
      gx="$(printf '%s\n' "$geometry" | sed -n 's/^X=//p')"
      gy="$(printf '%s\n' "$geometry" | sed -n 's/^Y=//p')"
      if ffmpeg -hide_banner -loglevel error -y -f x11grab -video_size "${WIDTH}x${HEIGHT}" \
        -i "${DISPLAY}+${gx:-0},${gy:-0}" -frames:v 1 "$temporary"; then
        mv "$temporary" "$output"
        return 0
      fi
    fi
    sleep 1
  done
  echo "error: could not capture window ${WID:-?} on $DISPLAY (is VS Code still running?)" >&2
  return 1
}

shot() {
  local id="$1"
  local output="$FRAMES/$id.png"
  if [[ -f "$output" && "$FORCE" != "1" ]]; then
    echo "keep   $id (exists; --force to overwrite)"
    return
  fi
  sleep "${SETTLE:-1.2}"
  capture_window "$output"
  echo "shot   $id"
}

open_view() {
  local title="$1"
  xdotool windowactivate --sync "$WID" 2>/dev/null || true
  xdotool key --clearmodifiers ctrl+shift+p
  sleep 0.5
  xdotool type --delay 15 "$title"
  sleep 0.9
  xdotool key Return
  sleep "${SETTLE:-1.2}"
}

echo "==> capturing"
open_view "View: Show mind"
shot 03-sidebar
open_view "mind: Open Queue"
shot 04-queue
open_view "mind: Open Signals"
shot 07-signals
open_view "mind: Open Directions"
shot 08-directions
open_view "mind: Open Learnings"
shot 09-learnings
open_view "mind: Open Analytics"
shot 10-analytics
open_view "mind: Open Devices"
shot 11-devices

if [[ -f "$FRAMES/04-queue.png" && ! -f "$FRAMES/16-close.png" ]]; then
  cp "$FRAMES/04-queue.png" "$FRAMES/16-close.png"
  echo "shot   16-close (copy of 04-queue)"
fi

for id in 05-details 06-approve; do
  [[ -f "$FRAMES/$id.png" ]] || echo "todo   $id needs a manual capture (click the row / Approve)"
done

echo
echo "frames in $FRAMES; next: node scripts/demo-video/mask.mjs"
