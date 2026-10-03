#!/usr/bin/env bash
set -euo pipefail

# GenID full certification pipeline demo — starts a session from an
# uploaded (externally-generated) image, finalizes it, and saves the
# resulting certificate PDF. See API.md "Full certification pipeline".
#
# This is the acceptance-test shape for "run an image from an external
# tool (Higgsfield, HeyGen, Midjourney, etc.) through the complete GenID
# process": point this at that tool's output.
#
# Usage:
#   GENID_API_KEY=gk_live_... ./scripts/demo-pipeline.sh /path/to/image.png
#   GENID_API_KEY=gk_live_... ./scripts/demo-pipeline.sh                     # uses the bundled sample image
#   GENID_API_KEY=gk_live_... GENID_BASE_URL=http://localhost:3000 ./scripts/demo-pipeline.sh   # local dev server
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

echo "==> Starting a session from $IMAGE_PATH ..."
SESSION_RESPONSE="$WORKDIR/session.json"
curl -sS -X POST "$BASE_URL/api/session" \
  -H "Authorization: Bearer $GENID_API_KEY" \
  -F "image=@${IMAGE_PATH}" \
  -o "$SESSION_RESPONSE"

SESSION_ERROR=$(jq -r '.error // empty' "$SESSION_RESPONSE")
if [ -n "$SESSION_ERROR" ]; then
  echo "Session creation failed: $SESSION_ERROR" >&2
  exit 1
fi

SESSION_ID=$(jq -r '.sessionId' "$SESSION_RESPONSE")
STEP_ID=$(jq -r '.stepId' "$SESSION_RESPONSE")
echo "    Session ID:  $SESSION_ID"
echo "    Step ID:     $STEP_ID"
echo

echo "==> Finalizing (hash-chain, C2PA manifest, Polygon anchor, certificate PDF) ..."
FINALIZE_RESPONSE="$WORKDIR/finalize.json"
curl -sS -X POST "$BASE_URL/api/session/${SESSION_ID}/finalize" \
  -H "Authorization: Bearer $GENID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o "$FINALIZE_RESPONSE"

FINALIZE_ERROR=$(jq -r '.error // empty' "$FINALIZE_RESPONSE")
if [ -n "$FINALIZE_ERROR" ]; then
  echo "Finalize failed: $FINALIZE_ERROR" >&2
  exit 1
fi

CERT_ID=$(jq -r '.certificateId' "$FINALIZE_RESPONSE")
ROOT_HASH=$(jq -r '.sessionRootHash' "$FINALIZE_RESPONSE")
TX_HASH=$(jq -r '.polygonAnchorTx' "$FINALIZE_RESPONSE")
VERIFY_URL=$(jq -r '.verifyUrl' "$FINALIZE_RESPONSE")
C2PA_EMBEDDED=$(jq -r '.c2paManifestEmbedded' "$FINALIZE_RESPONSE")

CERT_PATH="genid-certificate-${SESSION_ID}.pdf"
jq -r '.pdfBase64' "$FINALIZE_RESPONSE" | base64 -d > "$CERT_PATH"

echo "    Certificate ID:        $CERT_ID"
echo "    Session root hash:     $ROOT_HASH"
echo "    Polygon anchor tx:     ${TX_HASH:-pending}"
echo "    C2PA manifest embedded: $C2PA_EMBEDDED"
echo "    Public verify URL:     $VERIFY_URL"
echo "    Certificate saved to:  $CERT_PATH"
echo
echo "✓ End-to-end: upload → finalize → certificate succeeded."
echo "  Check $VERIFY_URL to independently confirm the hash chain, signature, and anchor."
