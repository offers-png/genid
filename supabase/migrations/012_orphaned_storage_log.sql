-- Durable log of storage paths left behind with no DB row pointing at them,
-- so they can be swept later instead of accumulating silently (Sept 18
-- fourth follow-up, "Fix orphaned storage cleanup"). Two known sources:
--
--  - app/api/session/[id]/step/route.ts uploads a step's output image
--    BEFORE the atomic active-check-then-insert (createStepIfActive,
--    migration 010). A rejected SESSION_NOT_ACTIVE (or any other insert
--    failure) leaves that upload with nothing referencing it. The route now
--    attempts an immediate delete on that path and only falls back to
--    logging here if the delete itself fails.
--  - lib/lifecycle.ts's archival step deletes the pre-compression original
--    after the archive is already committed to the DB; if that delete
--    fails, the original is left behind. Previously only a console.error,
--    which isn't reliably retained or queryable in production.
--
-- swept_at is set once a cleanup job (e.g. scripts/sweep-orphaned-storage.mjs)
-- confirms the path has been removed from storage.
create table if not exists genid_orphaned_storage_log (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  reason text not null,
  session_id uuid references genid_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  swept_at timestamptz
);

create index if not exists idx_orphaned_storage_log_unswept
  on genid_orphaned_storage_log (created_at)
  where swept_at is null;

alter table genid_orphaned_storage_log enable row level security;

-- Service-role only — this is an internal maintenance log, never read or
-- written from client-facing code paths.
create policy "Service role can select orphaned storage log" on genid_orphaned_storage_log
  for select to service_role using (true);

create policy "Service role can insert orphaned storage log" on genid_orphaned_storage_log
  for insert to service_role with check (true);

create policy "Service role can update orphaned storage log" on genid_orphaned_storage_log
  for update to service_role using (true);
