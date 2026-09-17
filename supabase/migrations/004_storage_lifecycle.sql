-- GENID Protocol: Storage lifecycle (Build Spec v1.0, Section 7)
--
-- Adds the one column verification needs to distinguish "this step's stored
-- file was replaced with a compressed archival copy after finalize" from
-- "this step's file was tampered with." Both produce the same symptom (the
-- current file's hash no longer matches output_hash) — this column is what
-- tells verification which one it's looking at.
--
-- output_hash itself is never touched by archival. It stays a permanent
-- record of the ORIGINAL file's hash, exactly as it was at signing time,
-- whether or not those original bytes still exist in storage. The
-- signature chain's tamper-evidence comes from the stored hash/signature
-- values, not from the file surviving unchanged — see lib/verify.ts.

alter table genid_steps
  add column if not exists output_archived boolean not null default false;

comment on column genid_steps.output_archived is
  'True once this step''s stored output was replaced with a compressed archival copy after session finalize (never applied to the final/selected step). output_hash still records the ORIGINAL file''s hash and will not match a re-hash of the current file — that mismatch is expected once this flag is set, not evidence of tampering.';
