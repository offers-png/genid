-- GenID Protocol: finalize atomicity (Security & Trust Fix Punch List #5)
--
-- Generation, storage upload, blockchain anchoring, and the DB writes that
-- commit a finalize all happen as separate sequential steps with no lock
-- between them. Two concurrent finalize calls for the same session (a
-- retry after a client-side timeout, a double-click) could both read
-- status = 'active', both do the anchoring/certificate work, and race on
-- the final writes.
--
-- 'finalizing' gives the route a status it can claim atomically via
-- `update ... where status = 'active'` (lib/supabase.ts tryBeginFinalizing):
-- exactly one concurrent caller gets a row back, the other gets zero and
-- fails fast with "already finalizing" instead of redoing the work. The
-- unique constraint on genid_certificates.session_id is the actual
-- guarantee against a duplicate certificate row even if two callers
-- somehow both reach that insert.

alter table genid_sessions drop constraint if exists genid_sessions_status_check;
alter table genid_sessions add constraint genid_sessions_status_check
  check (status in ('active', 'finalizing', 'finalized', 'abandoned'));

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'genid_certificates_session_id_key'
  ) then
    alter table genid_certificates
      add constraint genid_certificates_session_id_key unique (session_id);
  end if;
end $$;
