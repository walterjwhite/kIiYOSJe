#!/bin/sh
#
# build-server.sh — install dependencies, build the packages, then (re)start
# the local server.
#
# Usage:
#   sh scripts/build-server.sh               install, build, restart
#   sh scripts/build-server.sh --no-restart  install and build only
#
# A running server is stopped through POST /admin/shutdown and the freshly
# built packages/server/dist/main.js is started in the background. Output goes
# to $MIND_DATA_DIR/server.log and the PID to server.pid beside it (default
# ~/.data/kIiYOSJe/mind). Restart is skipped when CI is set.

set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
RESTART=1

for arg in "$@"; do
  case "$arg" in
    --no-restart) RESTART=0 ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--no-restart]" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"
npm install
npx tsc --build packages/core packages/pipeline packages/server packages/cli

if [ "$RESTART" -eq 0 ]; then
  echo "Skipping restart (--no-restart)."
  exit 0
fi

if [ -n "${CI:-}" ]; then
  echo "Skipping restart (CI is set)."
  exit 0
fi

SERVER_URL="${MIND_SERVER_URL:-http://127.0.0.1:8787}"
CONFIG_DIR="${MIND_CONFIG_DIR:-$HOME/.config/kIiYOSJe/mind}"
DATA_DIR="${MIND_DATA_DIR:-$HOME/.data/kIiYOSJe/mind}"
TOKEN_FILE="$CONFIG_DIR/token"
LOG_FILE="$DATA_DIR/server.log"
PID_FILE="$DATA_DIR/server.pid"

# Any HTTP response, including 401, means the server is up.
is_up() {
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$SERVER_URL/health" 2>/dev/null || true)
  [ -n "$status" ] && [ "$status" != "000" ]
}

if is_up; then
  echo "==> Stopping the running server"
  token=$(cat "$TOKEN_FILE" 2>/dev/null || true)
  if [ -z "$token" ]; then
    echo "error: no API token at $TOKEN_FILE, so the server cannot be stopped." >&2
    echo "       Stop it yourself, or rerun with --no-restart." >&2
    exit 1
  fi
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
    -X POST -H "Authorization: Bearer $token" \
    "$SERVER_URL/admin/shutdown" 2>/dev/null || true)
  if [ "$status" != "200" ]; then
    echo "error: shutdown request failed (HTTP ${status:-none})." >&2
    exit 1
  fi
  i=0
  while is_up; do
    i=$((i + 1))
    if [ "$i" -ge 50 ]; then
      echo "error: the server did not stop within 10s." >&2
      exit 1
    fi
    sleep 0.2
  done
fi

mkdir -p "$DATA_DIR"
echo "==> Starting the server"
# Detached: the script exits, the server keeps running.
nohup node packages/server/dist/main.js >>"$LOG_FILE" 2>&1 </dev/null &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

# A zombie still answers kill -0, so inspect the process state instead.
process_alive() {
  state=$(ps -o stat= -p "$SERVER_PID" 2>/dev/null | tr -d '[:space:]' || true)
  [ -n "$state" ] && [ "${state#Z}" = "$state" ]
}

i=0
while ! is_up; do
  i=$((i + 1))
  if ! process_alive; then
    rm -f "$PID_FILE"
    echo "error: the server exited during startup. Last lines of $LOG_FILE:" >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    exit 1
  fi
  if [ "$i" -ge 100 ]; then
    rm -f "$PID_FILE"
    echo "error: the server did not answer within 20s. Last lines of $LOG_FILE:" >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.2
done

echo "Server is running at $SERVER_URL (pid $SERVER_PID, log $LOG_FILE)"
