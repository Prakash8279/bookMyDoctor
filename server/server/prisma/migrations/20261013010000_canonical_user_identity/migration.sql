-- Canonical user identity hardening.
--
-- Application code already lower-cases email addresses and stores Indian phone numbers as the
-- final 10 digits. This migration makes that rule true for legacy/imported rows too, then adds a
-- database-level case-insensitive email backstop. It intentionally aborts instead of guessing
-- which User row to keep if historical duplicates exist; merging identities requires a reviewed
-- data migration because appointments, payments and medical records may reference both rows.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize users: duplicate email identities exist after lower/trim normalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') <> ''
    GROUP BY CASE
      WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
        THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
      ELSE regexp_replace(phone, '[^0-9]', '', 'g')
    END
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize users: duplicate phone identities exist after digit normalization';
  END IF;
END $$;

UPDATE users
SET email = lower(btrim(email))
WHERE email <> lower(btrim(email));

UPDATE users
SET phone = CASE
  WHEN regexp_replace(phone, '[^0-9]', '', 'g') = '' THEN NULL
  WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
    THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
  ELSE regexp_replace(phone, '[^0-9]', '', 'g')
END
WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_key
  ON users (lower(btrim(email)));

COMMENT ON INDEX users_email_normalized_key IS
  'Prevents duplicate User identities that differ only by email case or surrounding whitespace.';
