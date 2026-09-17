# Data Retention Policy

_Internal/technical reference for what GenID actually does today. This is not a
substitute for a legal privacy policy — have counsel review before publishing
anything derived from this externally._

## What's stored

| Data | Where | Retention |
|---|---|---|
| Identity (name, email, Stripe verification) | `genid_registry` | Indefinite — see "Account & session deletion" below |
| Session/step metadata (prompts, notes, hashes, signatures) | `genid_sessions`, `genid_steps` | Indefinite, never modified once written |
| Step output images | Supabase Storage (`genid-sessions` bucket) | Full-resolution until the session is finalized; see "After finalize" below |
| Authorship Certificate (PDF) | Supabase Storage | Indefinite, full-resolution, never compressed |
| C2PA-embedded export (PNG) | Supabase Storage | Indefinite, full-resolution, never compressed |

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

**What compression does not change:** the step's `output_hash` and
`step_signature` in the database are permanent records of the *original*
file, computed at the moment it was created. They are never recomputed after
compression. A step flagged `output_archived = true` is *expected* to fail a
fresh re-hash of its current (compressed) file — that mismatch is what the
flag exists to explain, not evidence of tampering. The session's hash chain
and root hash don't depend on any file surviving unchanged; they depend only
on the hash/signature values already committed at write time. See
`lib/verify.ts` for how verification reflects this distinction, and
`/session/verify/[id]` for what a third party actually sees.

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
