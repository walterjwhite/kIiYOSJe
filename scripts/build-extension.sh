#!/usr/bin/env bash
#
# build.sh — build the mind VS Code extension into an installable .vsix.
#
# Usage:
#   ./build.sh            build packages + extension, then package the .vsix
#   ./build.sh --no-build skip the TypeScript build step (package only)
#
# Output: extension/mind-vscode-<version>.vsix
#
# Install it with:
#   code --install-extension extension/mind-vscode-<version>.vsix
# or via the Extensions view -> "..." menu -> "Install from VSIX...".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_DIR="$ROOT_DIR/extension"
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --no-build) SKIP_BUILD=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--no-build]" >&2
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
echo ""
echo "Install with:"
echo "  code --install-extension \"$VSIX_FILE\""
