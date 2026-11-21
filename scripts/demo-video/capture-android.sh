#!/usr/bin/env bash
#
# Capture the Android client screens from a running emulator or device.
#
#   ./capture-android.sh --reset
#   ./capture-android.sh --server-url http://10.0.2.2:8787
#
# Pairing is started through the server API (the operator token is read from
# ~/.config/kIiYOSJe/mind/token and never printed), then typed into the app.
# Taps are located by visible text via uiautomator, not by coordinates.
#
# Produces:
#   12-android-pair    fresh pairing screen
#   13-android-queue   paired, queue loaded
#   14-android-send    queue with a captured thought and Approve/Discard
#   15-android-stale   airplane mode, cached queue labelled stale
#
# Requirements: adb, a booted device/emulator, the debug APK installed, and the
# server bound beyond loopback (MIND_BIND_HOST=0.0.0.0 npm run demo:serve).
#
# Options:
#   --out DIR          screenshot directory (default: scripts/demo-video/frames)
#   --server-url URL   address the phone should use (default: http://10.0.2.2:8787)
#   --api URL          address this script uses (default: http://127.0.0.1:8787)
#   --reset            clear app data first, so the pairing screen is fresh
#   --no-pair          keep the existing pairing; capture queue screens only
#   --stale-mode X     'airplane' (default) or 'server-down' to get the stale queue
#   --force            overwrite existing frames

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMES="$HERE/frames"
PHONE_SERVER="http://10.0.2.2:8787"
API="http://127.0.0.1:8787"
RESET=0
PAIR=1
STALE_MODE="airplane"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) FRAMES="$2"; shift 2 ;;
    --server-url) PHONE_SERVER="$2"; shift 2 ;;
    --api) API="$2"; shift 2 ;;
    --reset) RESET=1; shift ;;
    --no-pair) PAIR=0; shift ;;
    --stale-mode) STALE_MODE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v adb >/dev/null || { echo "error: adb not found (nix shell nixpkgs#android-tools)" >&2; exit 1; }
export ADB_SERIAL="${ADB_SERIAL:-}"

adb_() {
  if [[ -n "$ADB_SERIAL" ]]; then adb -s "$ADB_SERIAL" "$@"; else adb "$@"; fi
}

adb wait-for-device
for _ in $(seq 1 90); do
  [[ "$(adb_ shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
  sleep 2
done
adb_ shell getprop sys.boot_completed | tr -d '\r' | grep -q 1 || {
  echo "error: device did not finish booting" >&2; exit 1
}

mkdir -p "$FRAMES"
tap_text() { node "$HERE/tap-text.mjs" "$@"; }
screenshot() {
  local id="$1"
  if [[ -f "$FRAMES/$id.png" && "$FORCE" != "1" ]]; then
    echo "keep   $id (exists; --force to overwrite)"
    return
  fi
  adb_ exec-out screencap -p >"$FRAMES/$id.png"
  echo "shot   $id"
}

AIRPLANE_ON=0
restore() {
  if [[ "$AIRPLANE_ON" == "1" ]]; then
    adb_ shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true
  fi
}
trap restore EXIT

[[ "$RESET" == "1" ]] && adb_ shell pm clear dev.mind.android >/dev/null

adb_ shell am start -n dev.mind.android/.MainActivity >/dev/null
sleep 3
screenshot 12-android-pair

if [[ "$PAIR" == "1" ]]; then
  TOKEN_FILE="${MIND_TOKEN_FILE:-$HOME/.config/kIiYOSJe/mind/token}"
  [[ -f "$TOKEN_FILE" ]] || { echo "error: no operator token at $TOKEN_FILE" >&2; exit 1; }

  pairing="$(curl -fsS -X POST \
    -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
    -H "content-type: application/json" \
    -d '{"name":"Demo phone","kind":"android","scopes":["read","capture","send"]}' \
    "$API/devices/pairing")"
  code="$(node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>process.stdout.write(JSON.parse(s).code))' <<<"$pairing")"
  echo "==> pairing with a fresh six-digit code"

  tap_text "Server address"
  sleep 0.4
  adb_ shell input keyevent KEYCODE_MOVE_END
  adb_ shell input text "$PHONE_SERVER"
  tap_text "Six-digit code"
  sleep 0.4
  adb_ shell input text "$code"
  sleep 0.4
  tap_text "Pair"
  sleep 4
fi

screenshot 13-android-queue

if adb_ shell uiautomator dump --compressed /dev/tty 2>/dev/null | grep -q "Acknowledge"; then
  tap_text "Acknowledge" || true
  sleep 1
fi

tap_text "Capture"
sleep 1
tap_text "Title"
adb_ shell input text "Demo%sthought"
sleep 0.4
tap_text --last "Capture"
sleep 2
screenshot 14-android-send

if [[ "$STALE_MODE" == "airplane" ]]; then
  AIRPLANE_ON=1
  adb_ shell cmd connectivity airplane-mode enable >/dev/null
  sleep 2
  tap_text "Refresh"
  sleep 4
  screenshot 15-android-stale
  adb_ shell cmd connectivity airplane-mode disable >/dev/null
  AIRPLANE_ON=0
else
  echo "==> stop the server, then press Enter to capture the stale queue"
  read -r _
  tap_text "Refresh"
  sleep 3
  screenshot 15-android-stale
fi

echo
echo "frames in $FRAMES; next: node scripts/demo-video/mask.mjs"
