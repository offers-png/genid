# GenID External API

An HTTP API for GenID's image flows — for an agency, plugin, or platform
calling GenID directly rather than through the browser app. Two tiers:

- **Lightweight stamp/verify** (`/api/v1/stamp`, `/api/v1/verify`) — embed a
  watermark into an existing image, or check one. One call, one response.
- **Full certification pipeline** (`/api/session` and friends) — the same
  session/finalize flow the browser app uses: hash-chained steps, a C2PA/CAWG
  manifest, a Polygon anchor, and a signed certificate PDF. As of Oct 2026
  this also accepts a session starting from an **externally-generated**
  image (Higgsfield, HeyGen, Midjourney, etc.), not only GenID's own OpenAI
  generation step.

Both are scoped to **images only** for now — video, code, and text content
types are a later phase.

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

The same key works for both tiers — every route below that requires
authentication accepts either this `Authorization: Bearer` header or (if
you're calling from a browser with an active GenID session) the session
cookie. A route's auth check doesn't care which one it got; both resolve to
the same identity.

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

## Full certification pipeline

These are the **same endpoints the browser app uses** — not a separate
`/v1/` surface — now also reachable with an API key instead of a session
cookie. If you've used GenID's browser session flow, this is that flow;
if not, the shape below is everything you need.

A session always has one or more **steps** and gets **finalized** once:
finalizing picks a step as the final output, hash-chains the whole step
history, anchors the chain's root hash on Polygon, embeds a C2PA/CAWG
manifest, and generates a signed certificate PDF. The flow below is the
minimal path — one step, immediately finalized — which is what "run an
externally-generated image through the full pipeline" means in practice.

### 1. `POST /api/session` — start a session from an uploaded image

**Headers:** `Authorization: Bearer <your API key>`

**Body** — `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `image` | file | yes | JPEG, PNG, or WebP. Max 15 MB, max 8000px on either side. Re-encoded to PNG internally regardless of input format — every downstream step (C2PA embedding in particular) assumes PNG. |

**Response — 200**

```json
{
  "sessionId": "b2c3d4e5-...",
  "stepId": "c3d4e5f6-...",
  "outputHash": "9f1a... (sha256 of the normalized PNG)",
  "stepSignature": "7e2a..."
}
```

(This same endpoint also accepts `application/json { "promptText": "..." }`
to generate step 1 with GenID's own OpenAI pipeline instead of uploading one
— that's the browser app's own flow, included here for completeness, not
something this round changed.)

**Errors:** 400 (missing/invalid/oversized image), 401 (bad/missing auth),
403 (identity not Stripe-verified), 413, 429 (see Rate limits).

### 2. `POST /api/session/{sessionId}/finalize` — finalize and certify

**Headers:** `Authorization: Bearer <your API key>`

**Body** — `application/json`, optional: `{ "stepId": "..." }` to finalize a
specific step (defaults to the most recent one — for the minimal upload
flow above, there's only the one).

**Response — 200**

```json
{
  "certificateId": "d4e5f6a7-...",
  "pdfBase64": "JVBERi0xLjQK...",
  "sessionRootHash": "a1b2...",
  "polygonAnchorTx": "0xabc... or null if the anchor is still pending",
  "verifyUrl": "https://genid.onrender.com/session/verify/b2c3d4e5-...",
  "c2paManifestEmbedded": true
}
```

`pdfBase64` is the full Authorship Certificate PDF, base64-encoded — decode
it to get the file. `verifyUrl` is a public page (no auth, no account)
anyone can use to independently re-check the hash chain, signature, and
Polygon anchor. This single response is everything requirement #4 of the
Oct 2026 spec asked for: the certificate, the manifest status, and the
anchor, in one call.

Finalize is idempotent — calling it again on an already-finalized session
returns the same certificate rather than re-finalizing.

**Errors:** 401, 403 (not your session), 404 (session not found), 409
(already being finalized by a concurrent request — retry shortly), 500.

### 3. `GET /api/session/{sessionId}/certificate` — re-download later

**Headers:** `Authorization: Bearer <your API key>`

Returns the certificate PDF directly (`Content-Type: application/pdf`), no
regeneration or re-anchoring — the stable link for re-fetching a
certificate you already finalized, without needing the full JSON response
from step 2 again.

### Other session endpoints

`GET /api/session` (list your sessions), `GET /api/session/{id}` (one
session's detail/step list), `POST /api/session/{id}/step` (add a
regenerate/edit step — OpenAI-based, not part of the upload flow above),
`GET /api/session/{id}/c2pa-export`, `GET /api/session/storage-summary` all
accept the same API key. These exist for completeness; the acceptance path
for an externally-generated image is steps 1–2 above.

## Rate limits

| Endpoint | Limit | Keyed by |
|---|---|---|
| `POST /api/v1/stamp` | 20 stamps / rolling 5 minutes | the GENID identity the key belongs to — shared with that identity's browser-dashboard usage, not a separate budget per key. Minting a second key for the same identity does not raise the limit. |
| `POST /api/v1/verify` | 20 verifications / rolling 5 minutes | caller's IP address (this endpoint is anonymous, so IP is the only available dimension) |
| `POST /api/session` (uploaded-image start) | 20 / rolling 5 minutes | same identity-scoped budget as `/api/v1/stamp` — an upload-started session and a stamp both count against the one shared allowance, not separate ones |
| `POST /api/session` (`promptText`, OpenAI generation) | 10 / rolling 5 minutes | the GENID identity — separate budget from the two above, since this one calls a paid external model API |
| `POST /api/session/{id}/finalize` | not separately limited | bounded indirectly — at most one Polygon anchor per session regardless of retries, and a session can only exist from an already rate-limited create call |

A 429 includes a JSON `error` message; there's currently no `Retry-After`
header — wait a few minutes and retry.

## CORS

Not enabled, for any route in this document — stamp/verify or the
certification pipeline. All of it is intended for server-to-server calls
today. If you need to call these directly from inside a browser context
you don't control the backend for (e.g. a Figma plugin's sandboxed
webview), that needs an explicit origin allow-list added — open an issue
or reach out before building against that assumption, since right now a
browser-based cross-origin call will be blocked.

## Demos

[`scripts/demo-api.sh`](scripts/demo-api.sh) — stamp a sample image, then
verify the stamped output, end to end:

```bash
GENID_API_KEY=gk_live_your_key_here ./scripts/demo-api.sh
```

[`scripts/demo-pipeline.sh`](scripts/demo-pipeline.sh) — run an image
through the full certification pipeline: start a session from an uploaded
image, finalize it, and save the resulting certificate PDF:

```bash
GENID_API_KEY=gk_live_your_key_here ./scripts/demo-pipeline.sh /path/to/your-image.png
```
