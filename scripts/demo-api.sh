#!/usr/bin/env bash
set -euo pipefail

# GenID external API demo — stamps a sample image, then verifies the
# stamped output, end to end. See API.md for the full reference.
#
# Usage:
#   GENID_API_KEY=gk_live_... ./scripts/demo-api.sh
#   GENID_API_KEY=gk_live_... ./scripts/demo-api.sh /path/to/your/image.png
#   GENID_API_KEY=gk_live_... GENID_BASE_URL=http://localhost:3000 ./scripts/demo-api.sh   # local dev server
#
# Requires curl and jq.

if [ -z "${GENID_API_KEY:-}" ]; then
  echo "Set GENID_API_KEY to an API key from https://genid.onrender.com/dashboard/api-keys" >&2
  echo "(requires a Stripe-identity-verified GENID — see https://genid.onrender.com/register)" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "This script needs jq to parse API responses. Install it (apt install jq / brew install jq) and re-run." >&2
  exit 1
fi

BASE_URL="${GENID_BASE_URL:-https://genid.onrender.com}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_PATH="${1:-$SCRIPT_DIR/assets/sample-image.png}"

if [ ! -f "$IMAGE_PATH" ]; then
  echo "Image not found: $IMAGE_PATH" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Stamping $IMAGE_PATH ..."
STAMP_RESPONSE="$WORKDIR/stamp.json"
curl -sS -X POST "$BASE_URL/api/v1/stamp" \
  -H "Authorization: Bearer $GENID_API_KEY" \
  -F "image=@${IMAGE_PATH}" \
  -o "$STAMP_RESPONSE"

STAMP_ERROR=$(jq -r '.error // empty' "$STAMP_RESPONSE")
if [ -n "$STAMP_ERROR" ]; then
  echo "Stamp failed: $STAMP_ERROR" >&2
  exit 1
fi

GENID_CODE=$(jq -r '.genidCode' "$STAMP_RESPONSE")
RECORD_ID=$(jq -r '.verificationRecordId' "$STAMP_RESPONSE")
TX_HASH=$(jq -r '.blockchainTxHash' "$STAMP_RESPONSE")
STAMPED_PATH="$WORKDIR/stamped.png"
jq -r '.image.base64' "$STAMP_RESPONSE" | base64 -d > "$STAMPED_PATH"

echo "    Stamped by:       $GENID_CODE"
echo "    Verification ID:  $RECORD_ID"
echo "    Blockchain TX:     ${TX_HASH:-pending}"
echo "    Stamped image:    $STAMPED_PATH"
echo

echo "==> Verifying the stamped output ..."
VERIFY_RESPONSE="$WORKDIR/verify.json"
curl -sS -X POST "$BASE_URL/api/v1/verify" \
  -F "image=@${STAMPED_PATH}" \
  -o "$VERIFY_RESPONSE"

VERIFY_ERROR=$(jq -r '.error // empty' "$VERIFY_RESPONSE")
if [ -n "$VERIFY_ERROR" ]; then
  echo "Verify failed: $VERIFY_ERROR" >&2
  exit 1
fi

VERIFIED=$(jq -r '.verified' "$VERIFY_RESPONSE")
MESSAGE=$(jq -r '.message' "$VERIFY_RESPONSE")

echo "    Verified:  $VERIFIED"
echo "    Message:   $MESSAGE"
echo

if [ "$VERIFIED" = "true" ]; then
  echo "✓ End-to-end: stamp → verify succeeded."
else
  echo "✗ Stamped image did not verify — see the message above." >&2
  exit 1
fi
