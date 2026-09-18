# Data Retention Policy

_Internal/technical reference for what GenID actually does today. This is not a
substitute for a legal privacy policy — have counsel review before publishing
anything derived from this externally._

## What's stored

| Data | Where | Retention |
|---|---|---|
| Identity (name, email, Stripe verification) | `genid_registry` | Indefinite — see "Account & session deletion" below |
| Session/step metadata (prompts, notes, hashes, signatures) | `genid_sessions`, `genid_steps` | Indefinite. The chain fields (`output_hash`, `step_hash`, `step_signature`, `prior_step_signature`) are never modified once written. Other columns ARE updated over a session's lifecycle — see below. |
| Step output images | Supabase Storage (`genid-sessions` bucket) | Full-resolution until the session is finalized; see "After finalize" below |
| Authorship Certificate (PDF) | Supabase Storage | Indefinite, full-resolution, never compressed |
| C2PA-embedded export (PNG) | Supabase Storage | Indefinite, full-resolution, never compressed |

## What actually changes after a row is written

To be specific about "never modified" above: `output_hash`, `step_hash`,
`step_signature`, and `prior_step_signature` on `genid_steps` are permanent
once written — that's the whole point of the hash chain. But other columns
on the same tables genuinely are updated later in a session's life, by
design:

- `genid_steps.is_final_selection` changes when a different step is chosen
  as final (`markStepFinal`).
- `genid_steps.output_storage_path`, `output_archived`, `archive_hash`,
  `archive_signature` change together, once, when a non-final step is
  compressed after finalize (`lib/lifecycle.ts` — see "After finalize"
  below for exactly how).
- `genid_sessions.status`, `finalizing_since`, `finalizing_lock_token`,
  `session_root_hash`, `polygon_anchor_tx`, `final_step_id`, `finalized_at`,
  `c2pa_manifest_id` all change over a session's lifecycle (active →
  finalizing → finalized, or back to active if finalize fails).

None of this is enforced by a database constraint — it's what the
application code actually does, described accurately rather than
described as an "append-only" or "immutable" guarantee the database
itself provides. See the Security section of `README.md`.

## Before finalize

Every step's output is stored at full resolution, exactly as generated or
edited. Nothing is deleted or compressed while a session is still active —
you can regenerate, edit, and switch which version you're calling final as
many times as you like.

## After finalize

The **final/selected step** and the **certificate and C2PA export** are never
touched — they stay full-resolution for as long as the session record exists.

Every **non-final step** (rejected regenerations, superseded edits) is
compressed shortly after finalize: resized to a maximum 512px edge and
re-encoded as a palette PNG. This is what actually bounds storage growth per
session — see `lib/lifecycle.ts`.

**How compression stays recoverable:** the compressed copy is uploaded to a
new storage path first — the original file is left untouched at its own
path. Only after that upload succeeds does one database write commit
`output_storage_path` (repointed at the new file), `output_archived`,
`archive_hash`, and `archive_signature` together. Only *after that write
commits* is the original file deleted, and a failure to delete it is treated
as harmless leftover storage, not an error. A crash or DB failure at any
point before that single commit leaves the step exactly as it was before
compression started — safely retriable, nothing lost or half-swapped.

**What compression does not change:** the step's `output_hash` and
`step_signature` in the database are permanent records of the *original*
file, computed at the moment it was created. They are never recomputed after
compression, and `archive_hash`/`archive_signature` (bound to this session,
step, and original `output_hash` — see `lib/chain.ts`) are what verification
checks the compressed file against instead. A step with no archive
hash/signature recorded, or one whose current file doesn't match them,
reports as **unverified**, not silently passed — a missing proof and a valid
proof are different claims. The session's hash chain and root hash don't
depend on any file surviving unchanged; they depend only on the
hash/signature values already committed at write time. See `lib/verify.ts`
for how verification reflects this, and `/session/verify/[id]` for what a
third party actually sees.

**What this means in practice:** once a session is finalized, you can no
longer download the original full-resolution version of a rejected step —
only its compressed archival copy. The final output and the certificate are
unaffected.

## Blockchain anchor

When Polygon anchoring succeeds, the transaction is permanent and external to
GenID — deleting a GenID record does not and cannot remove it from the
blockchain. Anchoring is optional and non-blocking; a session's certificate
is fully valid without one (see the certificate PDF and `/session/verify/[id]`
for whether a given session has one).

## Account & session deletion

**There is currently no deletion capability in the product** — no "delete my
account" or "delete this session" endpoint exists in the codebase as of this
writing. Retention is, in practice, indefinite for every record above. If you
need to support account deletion (e.g., for a privacy request), that requires
new work: removing or anonymizing `genid_registry`/`genid_sessions`/
`genid_steps` rows and their Storage objects, and deciding how to handle rows
already referenced by a certificate or C2PA export someone else may hold a
copy of.

## Non-payment / subscription lapse

GenID has no subscription or billing tier today — Stripe is used only for
Identity verification (KYC), not payment. There is no non-payment-triggered
deletion policy because there is nothing to lapse. If a paid tier is added
later, this document should be updated with what happens to a user's data
when a subscription ends.
