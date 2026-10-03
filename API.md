# GenID External API

A minimal HTTP API for notarizing an existing image with GenID and verifying
one later — for an agency, plugin, or platform calling GenID directly rather
than through the browser app. This covers the stamp/verify flow only; the
full in-app session/generation workflow isn't exposed here.

Base URL: `https://genid.onrender.com`

## Authentication

`POST /api/v1/stamp` requires an API key. Generate one from
**[/dashboard/api-keys](https://genid.onrender.com/dashboard/api-keys)**
(you need a Stripe-identity-verified GENID first — sign up at
[/register](https://genid.onrender.com/register)). The raw key is shown
**once**, at creation time, and can't be retrieved again — if you lose it,
revoke it and generate a new one.

Send it as a standard bearer token:

```
Authorization: Bearer gk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`POST /api/v1/verify` is public — no API key, no account. Anyone can verify
any file.

A key is scoped to the GENID identity that created it and inherits that
identity's Stripe-identity-verified status. Revoking a key takes effect
immediately; a key that's never been revoked and matches a stored hash is
always considered valid (there's no separate expiry).

## `POST /api/v1/stamp`

Embeds a cryptographically signed GenID watermark into an image and anchors
its hash on Polygon. This is the API equivalent of the "Stamp New Image"
flow in the dashboard.

**Headers**

| Header | Value |
|---|---|
| `Authorization` | `Bearer <your API key>` |

**Body** — `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `image` | file | yes | JPEG, PNG, or WebP. Max 15 MB, max 8000px on either side. |

**Response — 200**

```json
{
  "verificationRecordId": "a1b2c3d4-...",
  "genidCode": "SA12345",
  "contentHash": "b5b2...  (sha256 of the STAMPED output)",
  "originalContentHash": "9f1a...  (sha256 of what you uploaded)",
  "blockchainTxHash": "0xabc... or null if the Polygon anchor is still pending",
  "notaryTimestamp": 1730592000,
  "image": {
    "contentType": "image/png",
    "base64": "iVBORw0KGgoAAAANSU..."
  }
}
```

`image.base64` is the stamped PNG, base64-encoded — decode it to get the
file. The output is always PNG regardless of the input format (steganographic
embedding requires a lossless format).

**Errors**

| Status | Meaning |
|---|---|
| 400 | Missing/invalid `image` field, corrupt file, or over the size/dimension limit |
| 401 | Missing, malformed, or revoked/unknown API key |
| 403 | The key's identity hasn't completed Stripe identity verification |
| 413 | Request body too large |
| 429 | Rate limit exceeded (see below) — retry after a few minutes |
| 500 | Stamping succeeded but the verification record failed to save — safe to retry; nothing is returned in this case since the output wouldn't be verifiable |

## `POST /api/v1/verify`

Checks whether an image carries a valid GenID watermark and, if so, whether
it's been tampered with since it was stamped. No authentication.

**Body** — `multipart/form-data`

| Field | Type | Required |
|---|---|---|
| `image` | file | yes |

**Response — 200** (always 200 if the request itself was well-formed —
"not verified" is a normal result, not an error)

```json
{
  "verified": true,
  "genidCode": "SA12345",
  "creatorName": "Jane Doe",
  "identityVerified": true,
  "nameVerified": false,
  "registeredAt": "2026-09-18T12:00:00.000Z",
  "contentHash": "b5b2...",
  "blockchainTxHash": "0xabc...",
  "stampedAt": "2026-10-01T09:00:00.000Z",
  "platform": "GENID Protocol",
  "signaturePresent": true,
  "signatureValid": true,
  "contentMatchesRecord": true,
  "embeddedHash": "9f1a...",
  "message": "This file was stamped through GenID under GENID SA12345 — the submitter's identity was ID-verified, but the display name \"Jane Doe\" is self-reported, not confirmed by that ID document."
}
```

`verified: true` requires all three of: a notary signature is present, that
signature is cryptographically valid, and the exact uploaded bytes match the
record logged at stamp time (`contentMatchesRecord`). A `genidCode` can be
present with `verified: false` — that means a GenID watermark was found but
something about it doesn't check out (see `message` for which case).

**Errors**

| Status | Meaning |
|---|---|
| 400 | Missing/invalid `image` field, corrupt file, or over the size/dimension limit |
| 413 | Request body too large |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error |

## Rate limits

| Endpoint | Limit | Keyed by |
|---|---|---|
| `POST /api/v1/stamp` | 20 stamps / rolling 5 minutes | the GENID identity the key belongs to — shared with that identity's browser-dashboard usage, not a separate budget per key. Minting a second key for the same identity does not raise the limit. |
| `POST /api/v1/verify` | 20 verifications / rolling 5 minutes | caller's IP address (this endpoint is anonymous, so IP is the only available dimension) |

A 429 includes a JSON `error` message; there's currently no `Retry-After`
header — wait a few minutes and retry.

## CORS

Not enabled. These endpoints are intended for server-to-server calls today.
If you need to call `/api/v1/stamp` or `/api/v1/verify` directly from inside
a browser context you don't control the backend for (e.g. a Figma plugin's
sandboxed webview), that needs an explicit origin allow-list added — open an
issue or reach out before building against that assumption, since right now
a browser-based cross-origin call will be blocked.

## Demo

See [`scripts/demo-api.sh`](scripts/demo-api.sh) for a working two-command
example: stamp a sample image, then verify the stamped output, end to end.

```bash
GENID_API_KEY=gk_live_your_key_here ./scripts/demo-api.sh
```
