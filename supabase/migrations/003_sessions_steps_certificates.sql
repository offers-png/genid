-- GENID Protocol: Session / Step / Certificate schema (Build Spec v1.0, Section 10)
--
-- Adds the two entities that don't exist yet (Session, Certificate) and a new
-- Step table with the full sequencing + hash-chain field set up front, so a
-- later migration isn't needed to retrofit chaining onto live rows once
-- Phase 2/3 start writing to this table.
--
-- Identity binding is deliberately NOT re-modeled here: genid_sessions links
-- straight to the existing, already-verified genid_registry via genid_code.

create table if not exists genid_sessions (
  id uuid primary key default uuid_generate_v4(),
  genid_code text not null references genid_registry(genid_code),
  content_type text not null default 'image'
    check (content_type in ('image', 'text', 'code', 'video', 'audio')),
  status text not null default 'active'
    check (status in ('active', 'finalized', 'abandoned')),
  final_step_id uuid,
  session_root_hash text,
  polygon_anchor_tx text,
  -- Snapshot of genid_registry.verification_status at session creation time,
  -- so a later change to the user's verification doesn't rewrite history for
  -- a session that already happened under a different tier.
  identity_verification_tier text,
  c2pa_manifest_id text,
  created_at timestamptz default now(),
  finalized_at timestamptz
);

create table if not exists genid_steps (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references genid_sessions(id) on delete cascade,
  step_number integer not null,
  step_type text not null
    check (step_type in ('generate', 'regenerate', 'edit', 'discard')),
  edit_type text
    check (edit_type in ('color_adjust', 'region_edit', 'composite', 'text_rewrite', 'crop', 'other')),
  prompt_text text,
  model_used text,
  model_request_id text,
  request_timestamp timestamptz,
  response_timestamp timestamptz,
  output_storage_path text,
  output_hash text,
  -- Chain fields (Phase 3): populated once hash-chaining logic lands.
  -- Present now so Phase 2 doesn't write rows against a schema that then
  -- needs retrofitting.
  prior_step_signature text,
  step_hash text,
  step_signature text,
  user_note text,
  auto_suggested_note text,
  is_final_selection boolean not null default false,
  created_at timestamptz default now(),
  unique (session_id, step_number)
);

alter table genid_sessions
  add constraint fk_genid_sessions_final_step
  foreign key (final_step_id) references genid_steps(id);

create table if not exists genid_certificates (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references genid_sessions(id),
  generated_at timestamptz default now(),
  pdf_export_path text,
  json_export_path text,
  c2pa_manifest_embedded boolean not null default false,
  public_verify_url text,
  total_steps integer,
  total_duration_seconds integer,
  content_type text,
  identity_verification_tier text,
  final_output_thumbnail_path text
);

create index if not exists idx_genid_sessions_genid_code on genid_sessions(genid_code);
create index if not exists idx_genid_sessions_status on genid_sessions(status);
create index if not exists idx_genid_steps_session_id on genid_steps(session_id);
create index if not exists idx_genid_certificates_session_id on genid_certificates(session_id);

-- Row level security — no public policies. Unlike genid_registry/genid_content_log
-- (which are meant to be publicly checkable), a session may contain rejected or
-- unfinished drafts the user never chose to publish. All access goes through API
-- routes using the service-role key, which bypasses RLS the same way the rest of
-- the app already does.
alter table genid_sessions enable row level security;
alter table genid_steps enable row level security;
alter table genid_certificates enable row level security;

-- Storage bucket for raw step output files. Private — served only via API
-- routes (service role), never listed or fetched directly by anon clients.
insert into storage.buckets (id, name, public)
values ('genid-sessions', 'genid-sessions', false)
on conflict (id) do nothing;
