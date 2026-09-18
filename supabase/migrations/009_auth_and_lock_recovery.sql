-- GenID Protocol: session ownership, finalize lock recovery, verified-name
-- tracking (Sept 18 follow-up to the Sept 17 Security & Trust Fix Punch List)

-- Magic-link tokens (lib/auth.ts). Random token is only ever held by the
-- caller; the DB stores its SHA-256 hash so a leaked row can't be redeemed.
-- Single-use is enforced by the token_hash unique constraint plus consuming
-- via an atomic UPDATE ... WHERE used_at IS NULL (see consumeMagicLinkToken).
create table if not exists genid_magic_link_tokens (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_genid_magic_link_tokens_email on genid_magic_link_tokens(email);

alter table genid_magic_link_tokens enable row level security;
-- No policies — service-role only, same pattern as genid_sessions/genid_steps.

-- Finalize lock recovery (Punch List #5 follow-up): tryBeginFinalizing sets
-- this when it claims the 'finalizing' status. A finalize call that crashes
-- hard enough to skip even the catch block's abortFinalizing (process kill,
-- uncaught rejection) would otherwise leave a session stuck in 'finalizing'
-- forever, since only the same route's own catch block ever released it.
-- A later finalize call can now check finalizing_since's age and reclaim a
-- stale lock instead of returning "already finalizing" indefinitely.
alter table genid_sessions
  add column if not exists finalizing_since timestamptz;

-- Verified-name tracking (Punch List #2 follow-up): the verified webhook
-- previously left user_name as whatever was self-reported whenever Stripe's
-- verified_outputs had no name to reconcile against (some verification
-- flows don't return one) — silently letting a self-reported name keep
-- riding on `verified: true`. name_verified makes that distinction explicit
-- everywhere the name is displayed (certificate, verify page, dashboard).
--
-- Defaults to false for every existing row, including already-verified
-- ones: this repo never stored Stripe's verified_outputs before now, so
-- there is no evidence to reconcile against for historical rows — claiming
-- retroactive name verification we can't prove would be exactly the kind
-- of unearned claim this column exists to prevent.
alter table genid_registry
  add column if not exists name_verified boolean not null default false;
