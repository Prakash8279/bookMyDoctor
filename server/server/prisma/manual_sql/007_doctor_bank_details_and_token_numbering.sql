-- BookMyDoctor24 — doctor bank details (admin/superadmin-only) + per-doctor token-numbering mode.
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE, hand-written for the same reason 001-006 are: this
-- sandbox has no DB/network access to run `npx prisma migrate dev`. Run this by hand via
-- psql/pgAdmin against the real database, after 001-006 already exist (no ordering dependency on
-- any of them specifically — this only touches doctor_profiles).
--
-- Context 1 — bank details (request: "doctor bank details v only admin and super admin dekh
-- sakta hai add kro"): four new nullable columns on doctor_profiles so a doctor can enter payout
-- bank details from their own profile page. Visibility is enforced entirely in application code
-- (doctors.service.js#shapeDoctor's includeContact gate — self or admin/superadmin only, the
-- exact same pattern already used for verification_documents), not at the database layer; these
-- columns hold no DB-level access control of their own.
--
-- Context 2 — token-numbering mode (request: "doctor ek booking rule do jo booking online wala
-- continues token no jayega ya odd ya even patient ko mile"): one new NOT NULL column with a
-- default, so every existing doctor row is valid immediately with no backfill needed
-- ('sequential' reproduces the exact pre-existing token-numbering behavior). A CHECK constraint
-- pins it to the two values appointments.service.js#runBookingJob actually understands —
-- anything else would silently fall back to 'sequential' in application code, but rejecting it
-- at the DB layer catches a typo/bad migration earlier.
--
-- Idempotent (safe to re-run): every ADD COLUMN uses IF NOT EXISTS; the CHECK constraint is
-- dropped and recreated so re-running this file doesn't fail on "constraint already exists".

ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS bank_account_holder_name VARCHAR(150);
ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(30);
ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS bank_ifsc_code VARCHAR(11);
ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS bank_name VARCHAR(150);

ALTER TABLE doctor_profiles
  ADD COLUMN IF NOT EXISTS token_numbering_mode VARCHAR(20) NOT NULL DEFAULT 'sequential';

ALTER TABLE doctor_profiles DROP CONSTRAINT IF EXISTS doctor_profiles_token_numbering_mode_check;
ALTER TABLE doctor_profiles
  ADD CONSTRAINT doctor_profiles_token_numbering_mode_check
  CHECK (token_numbering_mode IN ('sequential', 'alternate'));
