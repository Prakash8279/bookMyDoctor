-- BookMyDoctor24 — consolidates prisma/manual_sql/001, 005, 006, 007, 008, 009, 010 into the
-- FORMAL, TRACKED migration history, so `prisma migrate deploy` alone produces the complete,
-- correct schema on a brand-new database — no manual `psql -f prisma/manual_sql/...` steps left.
--
-- WHY THIS EXISTS: this project's earliest schema work happened in a sandbox with no live
-- Postgres connection, so anything Prisma's schema DSL couldn't express (partial unique indexes,
-- triggers, CHECK constraints, GIN trigram indexes) — and even a few things it COULD express —
-- was captured as hand-written SQL under prisma/manual_sql/ instead of a real tracked migration,
-- then run by hand against the real database. That worked, but it means a fresh database (a new
-- hosting environment, a teammate's machine, disaster recovery) needs `prisma migrate deploy`
-- PLUS ten manual psql runs in the right order — easy to get wrong, easy to forget a step.
--
-- This migration is EVERY SQL STATEMENT from manual_sql/001, 005, 006, 007, 008, 009, and 010, in
-- that same order, unchanged. NOT included, on purpose:
--   - manual_sql/002 and 003: already exist in the tracked 20260823180301_init migration (verify
--     yourself: `grep -n "receptionist_profiles_clinic_id_idx\|family_member_id_fkey"
--     prisma/migrations/20260823180301_init/migration.sql`) — including them again here would be
--     redundant, not wrong (every statement below is idempotent either way), but there is no
--     reason to.
--   - manual_sql/004: a one-time DATA fix (renaming three seed rows' human-readable ids to real
--     UUIDs), not a schema change — it has no place in migration history and must never be re-run
--     against a database that already has real bookings referencing those UUIDs.
--   - The orphaned `prescriptions`/`prescription_medicines` tables (no Prisma model exists for
--     them, nothing in the app queries them) are DELIBERATELY left untouched here — that's a
--     separate decision (model them properly, or drop them) to make once, not something to fold
--     silently into a migration whose job is "make already-applied changes official."
--
-- IDEMPOTENT: every statement below uses IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, exactly
-- as each manual_sql file already documented itself. Safe to run against a database that already
-- has all of this from the manual runs (nothing changes) AND safe to run against a brand-new
-- database that has never seen any of it (creates everything from scratch). On your existing dev
-- database — where the manual_sql files already ran — you will NOT execute this file's SQL
-- directly; instead you tell Prisma "this migration's effects already exist" with
-- `npx prisma migrate resolve --applied 20260919120000_consolidate_manual_sql_baseline` (see
-- server/server/README.md).

-- ════════════════════════════════════════════════════════════════════════════════
-- From manual_sql/001_constraints_and_triggers.sql
-- ════════════════════════════════════════════════════════════════════════════════

-- 1. Double-booking prevention: two non-cancelled, non-no_show appointments cannot exist for the
-- same doctor at the same date+time. A partial unique index so cancelled/no_show rows don't block
-- rebooking that slot.
DROP INDEX IF EXISTS appointments_doctor_slot_unique;
CREATE UNIQUE INDEX appointments_doctor_slot_unique
  ON appointments (doctor_user_id, appointment_date, appointment_time)
  WHERE status NOT IN ('cancelled', 'no_show');

-- 2. Doctor rating / review_count — materialized aggregate, recomputed whenever a review's status
-- changes to or away from 'approved'.
CREATE OR REPLACE FUNCTION recompute_doctor_rating() RETURNS TRIGGER AS $$
DECLARE
  -- TEXT, not UUID: every id in this schema is Prisma's plain `String @default(uuid())` (no
  -- `@db.Uuid`), so doctor_user_id is a TEXT column, not the native `uuid` type.
  target_doctor_id TEXT;
BEGIN
  target_doctor_id := COALESCE(NEW.doctor_user_id, OLD.doctor_user_id);

  UPDATE doctor_profiles
  SET rating = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 2)
        FROM reviews
        WHERE doctor_user_id = target_doctor_id AND status = 'approved'
      ), 0),
      review_count = (
        SELECT COUNT(*) FROM reviews
        WHERE doctor_user_id = target_doctor_id AND status = 'approved'
      )
  WHERE user_id = target_doctor_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reviews_recompute_rating ON reviews;
CREATE TRIGGER trg_reviews_recompute_rating
  AFTER INSERT OR UPDATE OF status OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION recompute_doctor_rating();

-- 3. Singleton-row enforcement for the three config tables (only one row, id=1, ever), plus
-- seeding that row if it doesn't exist yet.
ALTER TABLE platform_charges DROP CONSTRAINT IF EXISTS platform_charges_singleton;
ALTER TABLE platform_charges ADD CONSTRAINT platform_charges_singleton CHECK (id = 1);

ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_singleton;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_singleton CHECK (id = 1);

ALTER TABLE booking_rules DROP CONSTRAINT IF EXISTS booking_rules_singleton;
ALTER TABLE booking_rules ADD CONSTRAINT booking_rules_singleton CHECK (id = 1);

INSERT INTO platform_charges (id, commission_percent, patient_convenience_fee, emergency_fee, gst_percent, apply_convenience_fee, apply_emergency_fee, updated_at)
VALUES (1, 10, 25, 50, 18, true, true, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO system_settings (id, platform_name, maintenance_mode, booking_fee, updated_at)
VALUES (1, 'Doctor Connect', false, 0, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO booking_rules (id, cancellation_window_hours, max_bookings_per_patient, default_slot_minutes, updated_at)
VALUES (1, 2, 5, 15, now())
ON CONFLICT (id) DO NOTHING;

-- 4. Receipt-number sequence for payments (server-generated, sequential, unique).
CREATE SEQUENCE IF NOT EXISTS payment_receipt_seq START WITH 1 INCREMENT BY 1;

-- ════════════════════════════════════════════════════════════════════════════════
-- From manual_sql/005_scalability_indexes.sql
-- ════════════════════════════════════════════════════════════════════════════════

-- Directory sort columns on doctor_profiles — backs sortBy=rating|fee|experience.
CREATE INDEX IF NOT EXISTS doctor_profiles_rating_idx
  ON doctor_profiles (rating);

CREATE INDEX IF NOT EXISTS doctor_profiles_consultation_fee_idx
  ON doctor_profiles (consultation_fee);

CREATE INDEX IF NOT EXISTS doctor_profiles_experience_years_idx
  ON doctor_profiles (experience_years);

-- Unfiltered admin "recent appointments" view.
CREATE INDEX IF NOT EXISTS appointments_date_time_idx
  ON appointments (appointment_date, appointment_time);

-- Trigram GIN indexes for leading-wildcard ILIKE name search. pg_trgm ships with core Postgres
-- (contrib module) — no external download needed, just enabling it on this database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS clinics_name_trgm_idx
  ON clinics USING gin (name gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════════
-- From manual_sql/006_admin_patient_search_indexes.sql
-- ════════════════════════════════════════════════════════════════════════════════

-- (pg_trgm already enabled by the 005 section above; CREATE EXTENSION IF NOT EXISTS is
-- idempotent either way, so repeating it here would be harmless, but there's no reason to.)

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_phone_trgm_idx
  ON users USING gin (phone gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════════════════
-- From manual_sql/007_doctor_bank_details_and_token_numbering.sql
-- ════════════════════════════════════════════════════════════════════════════════

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

-- ════════════════════════════════════════════════════════════════════════════════
-- From manual_sql/008_doctor_online_token_parity.sql
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE doctor_profiles
  ADD COLUMN IF NOT EXISTS online_token_parity VARCHAR(10) NOT NULL DEFAULT 'odd';

ALTER TABLE doctor_profiles DROP CONSTRAINT IF EXISTS doctor_profiles_online_token_parity_check;
ALTER TABLE doctor_profiles
  ADD CONSTRAINT doctor_profiles_online_token_parity_check
  CHECK (online_token_parity IN ('odd', 'even'));

-- ════════════════════════════════════════════════════════════════════════════════
-- From manual_sql/009_doctor_upi_id.sql
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS bank_upi_id VARCHAR(150);

-- ════════════════════════════════════════════════════════════════════════════════
-- From manual_sql/010_payment_payer_upi_id.sql
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_upi_id VARCHAR(150);
