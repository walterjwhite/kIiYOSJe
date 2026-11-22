#!/usr/bin/env bash
#
# build-extension.sh — build the mind VS Code extension into a .vsix and
# install it with the `code` CLI.
#
# Usage:
#   ./build-extension.sh              build, package, then install
#   ./build-extension.sh --no-build   skip the TypeScript build step (package only)
#   ./build-extension.sh --no-install package only; print the install command
#
# Output: extension/mind-vscode-<version>.vsix
#
# Install is skipped automatically when CI is set or the `code` CLI is not on
# PATH; the script then prints the command to run by hand.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_DIR="$ROOT_DIR/extension"
SKIP_BUILD=0
SKIP_INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --no-build) SKIP_BUILD=1 ;;
    --no-install) SKIP_INSTALL=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--no-build] [--no-install]" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> Building workspace packages (core, pipeline, server, cli)"
  npx tsc --build packages/core packages/pipeline packages/server packages/cli

  echo "==> Cleaning stale extension build output"
  rm -rf "$EXT_DIR/dist" "$EXT_DIR/tsconfig.tsbuildinfo"

  echo "==> Building the extension"
  npx tsc --build "$EXT_DIR"
else
  echo "==> Skipping build (--no-build)"
fi

if [[ ! -f "$EXT_DIR/dist/extension.js" ]]; then
  echo "error: $EXT_DIR/dist/extension.js not found after build — aborting package step" >&2
  exit 1
fi

echo "==> Packaging .vsix"
cd "$EXT_DIR"
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository

VSIX_FILE="$(ls -t "$EXT_DIR"/*.vsix | head -n1)"
echo ""
echo "Built: $VSIX_FILE"
echo "Manual install: code --install-extension \"$VSIX_FILE\" --force"
echo ""

if [[ "$SKIP_INSTALL" -eq 1 ]]; then
  echo "Skipping install (--no-install)."
elif [[ -n "${CI:-}" ]]; then
  echo "Skipping install (CI is set)."
elif ! command -v code >/dev/null 2>&1; then
  echo "Skipping install ('code' CLI not found on PATH)."
else
  echo "==> Installing into VS Code"
  # --force replaces an installed copy, so a rebuild is picked up instead of
  # being ignored as "already installed".
  code --install-extension "$VSIX_FILE" --force
  echo "Reload VS Code (Developer: Reload Window) to activate the new build."
fi
