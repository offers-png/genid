-- Apply before deploying the app. Budgets count attempts, not completions;
-- failed/ambiguous external calls retain reservations for five minutes.
-- One bounded row per identity/budget, with no accumulating event log.
create table public.genid_paid_quotas (
  genid_code text not null references public.genid_registry(genid_code) on delete cascade,
  operation text not null check (operation in ('generation', 'embed')),
  reserved_at timestamptz[] not null default '{}',
  primary key (genid_code, operation)
);
alter table public.genid_paid_quotas enable row level security;
revoke all on public.genid_paid_quotas from public, anon, authenticated;
grant select, insert, update on public.genid_paid_quotas to service_role;
create policy "Service role manages paid quotas" on public.genid_paid_quotas
  for all to service_role using (true) with check (true);

create function public.reserve_paid_operation(p_genid_code text, p_operation text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_limit integer;
  v_now timestamptz;
  v_recent timestamptz[];
begin
  v_limit := case p_operation when 'generation' then 10 when 'embed' then 20 else null end;
  if v_limit is null then raise exception 'Invalid quota operation'; end if;
  insert into public.genid_paid_quotas(genid_code, operation)
    values (p_genid_code, p_operation) on conflict do nothing;
  select reserved_at into v_recent from public.genid_paid_quotas
    where genid_code = p_genid_code and operation = p_operation for update;
  -- Read the clock after acquiring the lock (not transaction start time).
  v_now := clock_timestamp();
  select coalesce(array_agg(t), '{}'::timestamptz[]) into v_recent
    from unnest(v_recent) as t where t > v_now - interval '5 minutes';
  if cardinality(v_recent) >= v_limit then return false; end if;
  update public.genid_paid_quotas set reserved_at = array_append(v_recent, v_now)
    where genid_code = p_genid_code and operation = p_operation;
  return true;
end;
$$;
revoke all on function public.reserve_paid_operation(text, text) from public, anon, authenticated;
grant execute on function public.reserve_paid_operation(text, text) to service_role;
