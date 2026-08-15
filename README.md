# GENID Protocol

**Patent Pending — Priority Date April 27, 2026**

Universal identity infrastructure for AI-generated content. GENID Protocol cryptographically embeds a verified human identity into every AI-generated image at the moment of creation — invisible to the eye, permanent on the blockchain.

## How It Works

1. **Register** — User completes government ID verification via Stripe Identity
2. **Receive GENID** — A unique code (e.g. SA11212) is issued, tied to their verified identity
3. **Create a session** (`/session`) — Generate an image inside GenID's own pipeline. The prompt, model, output, hash, and HMAC-SHA256 signature are captured automatically at the moment of creation — no upload step. Regenerate with a new prompt or edit the current version (crop, color adjust) as many times as you like; nothing is ever deleted, and every version is chained to the one before it. Pick which version is final and hit Finalize to get a signed Authorship Certificate (PDF) covering the full version history, a session root hash anchored to Polygon, and a C2PA/CAWG manifest embedded in the exported image.
4. **Find it again** (`/dashboard`) — Every session shows up here by registered email: status, dates, a link back in, and a certificate download once one exists.
5. **Stamp** (`/embed`, legacy) — Upload an already-made AI image; GENID + notary signature embedded invisibly in pixels using LSB steganography. Kept for content generated outside GenID.
6. **Verify** (`/verify` for stamped images, `/session/verify/[id]` for sessions) — Anyone can check whether a signature is valid, a hash chain is intact, or a C2PA manifest is present — no GenID account required.

### C2PA / CAWG trust status

Exported images carry a real, structurally spec-valid C2PA manifest with a CAWG identity assertion (confirmed via embed → read-back round trip). It is signed with a genuine, non-self-signed certificate chain that is **not** issued through the official C2PA Conformance Program, so third-party verifiers (Adobe's Content Credentials verifier, etc.) will correctly report the signing credential as **untrusted** — that registration is an external business/legal process (security evaluation through an approved CA — SSL.com, DigiCert, or Trufo as of early 2026), not something this codebase can complete on its own. `/session/verify/[id]` shows the real validation status rather than papering over it. See `lib/c2pa.ts` for the full explanation.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Supabase (PostgreSQL)
- **Storage:** Supabase Storage (session step outputs, certificate PDFs)
- **Identity Verification:** Stripe Identity
- **Generation:** OpenAI `gpt-image-1` (Phase 1 Model Adapter — `lib/adapters/`)
- **Certificates:** PDF via pdfkit (`lib/certificate.ts`)
- **C2PA/CAWG:** `@contentauth/c2pa-node` (`lib/c2pa.ts`) — requires **Node.js >=22**
- **Steganography:** LSB pixel embedding via sharp (legacy post-hoc stamping)
- **Blockchain:** Polygon via Alchemy (optional)
- **Hosting:** Render (Web Service)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/offers-png/genid.git
cd genid
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in all values in `.env.local`. See `.env.example` for descriptions.

### 3. Set up Supabase

Run the migrations, in order, in your Supabase SQL editor:

```bash
# supabase/migrations/001_genid_registry.sql
# supabase/migrations/002_verification_status.sql
# supabase/migrations/003_sessions_steps_certificates.sql
# Paste each into Supabase Dashboard → SQL Editor and run in order.
```

Migration 003 also registers the `genid-sessions` Storage bucket (private —
session step outputs and certificate PDFs, served only through API routes).

### 4. Configure Stripe Identity

1. Go to Stripe Dashboard → Identity → enable it
2. Add a webhook endpoint pointing to `https://your-domain.com/api/stripe/webhook`
3. Select event: `identity.verification_session.verified`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

### 5. Run locally

```bash
npm run dev
```

App runs at `http://localhost:3000`

## Deployment (Render)

1. Create a new **Web Service** on Render
2. Connect the GitHub repo
3. Set build command: `npm install && npm run build`
4. Set start command: `npm run start`
5. Add all environment variables from `.env.example`, including the multi-line `C2PA_SIGNING_CERT_CHAIN_PEM` / `C2PA_SIGNING_KEY_PEM`
6. Confirm the service is on **Node.js 22 or newer** (`package.json` sets `engines.node`, but double-check Render's Node version setting matches — `@contentauth/c2pa-node` hard-requires it)
7. Deploy

## Security

- Database is **append-only** — no updates or deletes possible on content logs
- GENID verification status is **immutable** once granted
- Notary signatures use **HMAC-SHA256** with a server-side secret
- Only the server's `service_role` key can write to the database

## License

Patent Pending — © 2026 DealDily. All rights reserved.
