-- GenID Protocol: account deletion support (Oct 2026, compliance pass).
--
-- Deletion is implemented as anonymization, not a row delete: genid_code
-- stays live (it's referenced by genid_sessions/genid_steps/genid_certificates,
-- and by hash-chain content third parties may already be verifying against —
-- see DATA_RETENTION.md "Account & session deletion"). deleted_at records
-- when a user asked to be forgotten; the application layer (lib/account.ts)
-- is what actually clears user_name/self_reported_name/email to tombstone
-- values and revokes API keys — this migration only adds the column and
-- index a sweep/audit could use to find deleted accounts.

alter table genid_registry
  add column if not exists deleted_at timestamptz;

create index if not exists idx_genid_registry_deleted_at
  on genid_registry (deleted_at)
  where deleted_at is not null;
