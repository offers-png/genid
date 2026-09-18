-- GenID Protocol: bind the certificate's displayed name to Stripe Identity
-- verified_outputs, not the self-reported name typed at registration.
--
-- user_name previously stayed whatever the registrant typed in the
-- registration form, even after Stripe Identity verification succeeded —
-- the identity.verification_session.verified webhook only flipped
-- `verified: true` and never reconciled the name. Preserve the originally
-- typed value here for reference/support before the webhook overwrites
-- user_name with the document-verified name.

alter table genid_registry
  add column if not exists self_reported_name text;

update genid_registry
  set self_reported_name = user_name
  where self_reported_name is null;
