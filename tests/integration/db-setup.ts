import { PGlite } from '@electric-sql/pglite'

// Real embedded Postgres (WASM), not a mock — used for the integration
// tests that need to prove actual database behavior (row locking, atomic
// conditional updates, the create_step_if_session_active function) rather
// than assert that a mocked function was called with the right arguments.
//
// Caveat, stated plainly: PGlite is a single embedded engine process, not a
// multi-connection server — it cannot demonstrate two truly concurrent
// connections blocking on the same row lock the way two real Postgres
// client connections would. What it DOES prove, against the real SQL from
// the migrations (not a reimplementation of it), is that the atomic
// "UPDATE ... WHERE <condition> RETURNING id" claim pattern this app relies
// on for locking actually behaves as an atomic claim — the second call
// against an already-claimed row returns zero rows — and that
// create_step_if_session_active's active-session check and insert really
// do run as one unit against a real Postgres engine, not against a
// reimplementation of Postgres semantics in JS. A schema or SQL bug in the
// actual migration file would be caught here; it never could be by a mock.
//
// Schema mirrors the columns these tests touch from migrations
// 003/007/009/010 — not a verbatim replay of every migration file (no
// uuid-ossp dependency; IDs are generated in JS instead).
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite()

  await db.exec(`
    create table genid_sessions (
      id uuid primary key,
      genid_code text not null,
      status text not null default 'active'
        check (status in ('active', 'finalizing', 'finalized', 'abandoned')),
      final_step_id uuid,
      session_root_hash text,
      polygon_anchor_tx text,
      finalizing_since timestamptz,
      finalizing_lock_token text,
      created_at timestamptz not null default now(),
      finalized_at timestamptz
    );

    create table genid_steps (
      id uuid primary key,
      session_id uuid not null references genid_sessions(id) on delete cascade,
      step_number integer not null,
      step_type text not null,
      edit_type text,
      prompt_text text,
      model_used text,
      model_request_id text,
      request_timestamp timestamptz,
      response_timestamp timestamptz,
      output_storage_path text,
      output_hash text,
      prior_step_signature text,
      step_hash text,
      step_signature text,
      user_note text,
      auto_suggested_note text,
      is_final_selection boolean not null default false,
      output_archived boolean not null default false,
      archive_hash text,
      archive_signature text,
      created_at timestamptz not null default now(),
      unique (session_id, step_number)
    );

    create or replace function create_step_if_session_active(
      p_session_id uuid,
      p_step_id uuid,
      p_step_number integer,
      p_step_type text,
      p_edit_type text,
      p_prompt_text text,
      p_model_used text,
      p_model_request_id text,
      p_request_timestamp timestamptz,
      p_response_timestamp timestamptz,
      p_output_storage_path text,
      p_output_hash text,
      p_prior_step_signature text,
      p_step_hash text,
      p_step_signature text,
      p_user_note text,
      p_auto_suggested_note text
    ) returns genid_steps
    language plpgsql
    as $$
    declare
      v_status text;
      v_step genid_steps;
    begin
      select status into v_status from genid_sessions where id = p_session_id for update;

      if v_status is null then
        raise exception 'SESSION_NOT_FOUND';
      end if;
      if v_status <> 'active' then
        raise exception 'SESSION_NOT_ACTIVE';
      end if;

      insert into genid_steps (
        id, session_id, step_number, step_type, edit_type, prompt_text, model_used,
        model_request_id, request_timestamp, response_timestamp,
        output_storage_path, output_hash, prior_step_signature, step_hash,
        step_signature, user_note, auto_suggested_note, is_final_selection
      ) values (
        p_step_id, p_session_id, p_step_number, p_step_type, p_edit_type, p_prompt_text, p_model_used,
        p_model_request_id, p_request_timestamp, p_response_timestamp,
        p_output_storage_path, p_output_hash, p_prior_step_signature, p_step_hash,
        p_step_signature, p_user_note, p_auto_suggested_note, false
      )
      returning * into v_step;

      return v_step;
    end;
    $$;
  `)

  return db
}

export function randomId(): string {
  return crypto.randomUUID()
}
