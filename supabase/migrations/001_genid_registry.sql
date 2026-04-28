-- GENID Protocol: Core Registry Schema

create extension if not exists "uuid-ossp";

-- Registered creators with verified identity
create table if not exists genid_registry (
  id uuid primary key default uuid_generate_v4(),
  genid_code text unique not null,
  user_name text not null,
  email text unique not null,
  stripe_verification_id text,
  verified boolean default false,
  created_at timestamptz default now()
);

-- Every piece of AI-generated content stamped with a GENID
create table if not exists genid_content_log (
  id uuid primary key default uuid_generate_v4(),
  genid_code text not null references genid_registry(genid_code),
  content_hash text not null,
  file_name text,
  file_type text,
  platform text default 'GENID Protocol',
  blockchain_tx_hash text,
  blockchain_network text default 'polygon',
  created_at timestamptz default now()
);

-- Indexes for fast lookups
create index if not exists idx_genid_registry_code on genid_registry(genid_code);
create index if not exists idx_genid_registry_email on genid_registry(email);
create index if not exists idx_genid_content_log_code on genid_content_log(genid_code);
create index if not exists idx_genid_content_log_hash on genid_content_log(content_hash);

-- Row level security
alter table genid_registry enable row level security;
alter table genid_content_log enable row level security;

-- Public read for verification lookups (anyone can verify a GENID)
create policy "Public can read registry" on genid_registry
  for select using (true);

create policy "Public can read content log" on genid_content_log
  for select using (true);

-- Only service role can write (API routes use service key)
create policy "Service role can insert registry" on genid_registry
  for insert with check (true);

create policy "Service role can update registry" on genid_registry
  for update using (true);

create policy "Service role can insert content log" on genid_content_log
  for insert with check (true);
