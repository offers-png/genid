-- GenID Protocol: verifiable integrity for archived (compressed) steps
-- (Security & Trust Fix Punch List #6)
--
-- output_archived (004_storage_lifecycle.sql) told verification "don't
-- expect this file to match output_hash anymore," but nothing recorded
-- what the archived file's hash SHOULD be — verification just skipped the
-- file check entirely for an archived step. That means the compressed
-- file's own integrity was never actually checked: it could be replaced
-- with anything post-archival and still read as "valid," because
-- signatureValid/chainLinkValid don't depend on file content at all.
--
-- archive_hash/archive_signature are computed at compression time
-- (lib/lifecycle.ts) over the COMPRESSED bytes, signed the same way a step
-- hash is (HMAC-SHA256 with GENID_SIGNING_SECRET) so they can't be forged
-- without the signing secret. Verification for an archived step now checks
-- the CURRENT file against archive_hash (and archive_hash against
-- archive_signature), instead of skipping the check.

alter table genid_steps
  add column if not exists archive_hash text,
  add column if not exists archive_signature text;

comment on column genid_steps.archive_hash is
  'SHA-256 of the compressed archival file, recorded at archive time. Verification checks the current stored file against THIS, not output_hash, once output_archived is true.';

comment on column genid_steps.archive_signature is
  'HMAC-SHA256(archive_hash, GENID_SIGNING_SECRET), recorded at archive time — proves archive_hash itself was set by the archival process, not edited after the fact.';
