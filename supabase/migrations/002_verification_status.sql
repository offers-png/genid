ALTER TABLE genid_registry
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';

UPDATE genid_registry SET verification_status = 'verified' WHERE verified = true;
UPDATE genid_registry SET verification_status = 'pending' WHERE verified = false;
