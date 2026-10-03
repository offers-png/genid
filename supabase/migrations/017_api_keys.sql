-- External developer API (Oct 2026) — lets a verified identity call
-- POST /api/v1/stamp without a browser session cookie. Only a hash of the
-- key is ever stored (sha256, same pattern as the magic-link/registration
-- tokens in migrations 013/015); the raw key is shown to the user exactly
-- once, at creation time, and can never be retrieved again — key_prefix
-- exists purely so the dashboard can show "gk_live_AbCd…" to identify a
-- key for revocation without re-exposing the secret.
create table public.genid_api_keys (
  id uuid primary key default gen_random_uuid(),
  genid_code text not null references public.genid_registry(genid_code) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.genid_api_keys enable row level security;
revoke all on public.genid_api_keys from public, anon, authenticated;
grant select, insert, update on public.genid_api_keys to service_role;
create policy "Service role manages api keys" on public.genid_api_keys
  for all to service_role using (true) with check (true);

-- The only lookup the auth path does is "find the active key matching this
-- hash" — partial index (excluding revoked rows) keeps that lookup fast as
-- the table grows, without needing a separate is-revoked check after.
create index genid_api_keys_active_hash_idx on public.genid_api_keys (key_hash)
  where revoked_at is null;

create index genid_api_keys_genid_code_idx on public.genid_api_keys (genid_code);
