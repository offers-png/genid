-- GenID Protocol: replace the reusable Stripe verification-id check in
-- POST /api/auth/complete-registration with a real single-use, short-lived,
-- browser-bound token (Sept 19 fix — "it currently accepts the same Stripe
-- verification ID repeatedly to issue login cookies").
--
-- genid_registry.stripe_verification_id is a durable value that never
-- changes once set — comparing a client-supplied vsid against it let
-- anyone who ever learned that value (browser history, a referrer header,
-- a log line) replay it indefinitely, from any browser, to sign in as that
-- registrant. This table instead follows the exact pattern already used
-- for magic-link tokens (genid_magic_link_tokens): a random token, stored
-- only as its SHA-256 hash, single-use via an atomic
-- UPDATE ... WHERE used_at IS NULL, and short-lived via expires_at.
--
-- "Tied to the browser that started registration" is enforced by
-- delivery, not by anything stored here: POST /api/stripe/session sets the
-- raw token as an httpOnly cookie on its response, and
-- POST /api/auth/complete-registration reads it back from the request's
-- cookie rather than from any client-supplied field — a browser that never
-- received that cookie (including one that merely knows the registrant's
-- email) has no way to present it.
create table if not exists genid_registration_tokens (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_genid_registration_tokens_email on genid_registration_tokens(email);

alter table genid_registration_tokens enable row level security;
-- No policies — service-role only, same pattern as genid_magic_link_tokens.
