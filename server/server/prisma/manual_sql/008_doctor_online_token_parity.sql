-- BookMyDoctor24 — doctor-selectable online-booking token parity (odd/even).
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE, same reason 001-007 are hand-written: this sandbox has
-- no DB/network access to run `npx prisma migrate dev`. Run this by hand via psql/pgAdmin
-- against the real database, after 007 (which added doctor_profiles.token_numbering_mode — this
-- file assumes that column already exists, though nothing here breaks if run out of order since
-- both are independent ADD COLUMN statements on the same table).
--
-- Context (request: "odd ya even select karne ka option do doctor jo select kar online ke lie"):
-- 007 hard-coded 'alternate' token-numbering mode to always give online bookings the ODD
-- sequence and walk-ins the EVEN one. This column lets the doctor pick which parity online gets
-- instead — 'odd' (default, reproduces 007's original fixed behavior exactly, so no existing
-- doctor's numbering changes until they explicitly change this) or 'even' (flipped: online gets
-- the even sequence, walk-ins get the odd one). Only consulted by
-- appointments.service.js#runBookingJob when doctor_profiles.token_numbering_mode = 'alternate'
-- — harmless/ignored for a doctor still on the default 'sequential' mode.
--
-- Idempotent (safe to re-run): ADD COLUMN uses IF NOT EXISTS; the CHECK constraint is dropped
-- and recreated so re-running this file doesn't fail on "constraint already exists".

ALTER TABLE doctor_profiles
  ADD COLUMN IF NOT EXISTS online_token_parity VARCHAR(10) NOT NULL DEFAULT 'odd';

ALTER TABLE doctor_profiles DROP CONSTRAINT IF EXISTS doctor_profiles_online_token_parity_check;
ALTER TABLE doctor_profiles
  ADD CONSTRAINT doctor_profiles_online_token_parity_check
  CHECK (online_token_parity IN ('odd', 'even'));
