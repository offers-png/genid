-- GenID Protocol: scope registry RLS policies to service_role
--
-- 001_genid_registry.sql's policies (`using (true)` / `with check (true)`,
-- no `to <role>` clause) apply to EVERY role, including anon, despite the
-- comments claiming "only service role can write" and "public read for
-- verification lookups." Every read in this repo already goes through
-- Next.js API routes using the service key — there is no frontend code that
-- queries Supabase directly with the anon key — so scoping these to
-- service_role only removes a dormant exposure (anon-readable email column)
-- without changing any actual behavior.

drop policy if exists "Public can read registry" on genid_registry;
drop policy if exists "Public can read content log" on genid_content_log;
drop policy if exists "Service role can insert registry" on genid_registry;
drop policy if exists "Service role can update registry" on genid_registry;
drop policy if exists "Service role can insert content log" on genid_content_log;

create policy "Service role can select registry" on genid_registry
  for select to service_role using (true);

create policy "Service role can insert registry" on genid_registry
  for insert to service_role with check (true);

create policy "Service role can update registry" on genid_registry
  for update to service_role using (true);

create policy "Service role can select content log" on genid_content_log
  for select to service_role using (true);

create policy "Service role can insert content log" on genid_content_log
  for insert to service_role with check (true);
