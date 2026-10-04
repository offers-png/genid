#!/usr/bin/env bash
set -euo pipefail

# Packages /browser-extension into the zip served from /extension's
# "Download for Chrome" button. Re-run this and commit the result whenever
# the extension source changes — the zip under public/downloads/ is a
# committed, stable artifact, not generated at deploy time.
#
# Usage: npm run build:extension

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$REPO_ROOT/browser-extension"
OUT_DIR="$REPO_ROOT/public/downloads"
OUT_FILE="$OUT_DIR/genid-chrome-extension.zip"

if ! command -v zip >/dev/null 2>&1; then
  echo "This script needs the 'zip' CLI. Install it (apt install zip / brew install zip) and re-run." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

cd "$SRC_DIR"
zip -r -X -q "$OUT_FILE" manifest.json background.js options.html options.js popup.html popup.js icons

echo "Wrote $OUT_FILE"
