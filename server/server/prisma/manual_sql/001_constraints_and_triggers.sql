-- Doctor Connect — manual SQL supplement to the Prisma-generated migration.
--
-- Run this ONCE, after `npx prisma migrate dev` has created all tables from schema.prisma.
-- These are things Prisma's schema DSL cannot express: a partial unique index, triggers,
-- and singleton-row CHECK constraints. See server/README.md for the exact run command
-- (psql "$DATABASE_URL" -f prisma/manual_sql/001_constraints_and_triggers.sql).
--
-- This file is idempotent (safe to re-run) via IF NOT EXISTS / OR REPLACE / DROP...CREATE.

-- ────────────────────────────────────────────────────────────────
-- 1. Double-booking prevention (THE most important constraint in this schema)
-- Two non-cancelled, non-no_show appointments cannot exist for the same doctor at the same
-- date+time. A partial unique index (not a full unique index) so cancelled/no_show rows don't
-- block rebooking.
--
-- FIX (found by codebase audit): the WHERE clause originally only excluded 'cancelled', not
-- 'no_show', even though this comment always said both should be excluded. Since no_show has
-- no transition back to any other status (see appointments.service.js's APPOINTMENT_TRANSITIONS),
-- any appointment marked no_show — including one for a date that hasn't happened yet — would
-- permanently occupy its (doctor, date, time) slot with no way to free it. This file is
-- idempotent (DROP INDEX IF EXISTS + CREATE), so re-running it against an already-migrated
-- database picks up this fix.
-- ────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS appointments_doctor_slot_unique;
CREATE UNIQUE INDEX appointments_doctor_slot_unique
  ON appointments (doctor_user_id, appointment_date, appointment_time)
  WHERE status NOT IN ('cancelled', 'no_show');

-- ────────────────────────────────────────────────────────────────
-- 2. Doctor rating / review_count — materialized aggregate, recomputed whenever a
-- review's status changes to or away from 'approved' (fixes the current app's stale,
-- never-recomputed doctor.rating field).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_doctor_rating() RETURNS TRIGGER AS $$
DECLARE
  -- TEXT, not UUID: every id in this schema is Prisma's plain `String @default(uuid())` (no
  -- `@db.Uuid`), so doctor_user_id is a TEXT column, not the native `uuid` type. Declaring this
  -- as UUID happened to work with Prisma-generated ids (always valid UUID-formatted strings,
  -- which Postgres implicitly casts) but broke on any TEXT value that isn't UUID-shaped — caught
  -- by hand-testing this trigger against a real local Postgres instance with human-readable seed
  -- ids. Match the actual column type to avoid the fragility either way.
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

-- ────────────────────────────────────────────────────────────────
-- 3. Singleton-row enforcement for the three config tables (only one row, id=1, ever).
-- ────────────────────────────────────────────────────────────────
ALTER TABLE platform_charges DROP CONSTRAINT IF EXISTS platform_charges_singleton;
ALTER TABLE platform_charges ADD CONSTRAINT platform_charges_singleton CHECK (id = 1);

ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_singleton;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_singleton CHECK (id = 1);

ALTER TABLE booking_rules DROP CONSTRAINT IF EXISTS booking_rules_singleton;
ALTER TABLE booking_rules ADD CONSTRAINT booking_rules_singleton CHECK (id = 1);

-- Seed the three singleton rows if they don't exist yet (idempotent upsert).
INSERT INTO platform_charges (id, commission_percent, patient_convenience_fee, emergency_fee, gst_percent, apply_convenience_fee, apply_emergency_fee, updated_at)
VALUES (1, 10, 25, 50, 18, true, true, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO system_settings (id, platform_name, maintenance_mode, booking_fee, updated_at)
VALUES (1, 'Doctor Connect', false, 0, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO booking_rules (id, cancellation_window_hours, max_bookings_per_patient, default_slot_minutes, updated_at)
VALUES (1, 2, 5, 15, now())
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- 4. Receipt-number sequence for payments (server-generated, sequential, unique —
-- replaces the current frontend's array-index-based CDR-00000001 synthesis).
-- ────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS payment_receipt_seq START WITH 1 INCREMENT BY 1;

-- Usage from idGenerators.js: SELECT nextval('payment_receipt_seq'), then format as
-- 'CDR-' || LPAD(value::text, 8, '0') in application code (keeps formatting logic in JS,
-- not SQL, so it's easy to change later without another migration).

-- ────────────────────────────────────────────────────────────────
-- 5. Per-doctor-per-day token sequence is intentionally NOT a global Postgres SEQUENCE
-- (a global sequence would waste/skip numbers across doctors and reset nothing daily).
-- Token numbering is instead assigned inside a transaction using
-- `SELECT COALESCE(MAX(token_number),0)+1 FROM appointments WHERE doctor_user_id=$1
--  AND appointment_date=$2` — see appointments.service.js (runBookingJob). Note: this is a
-- plain SELECT, NOT `... FOR UPDATE` — Postgres rejects a locking clause on a query whose
-- result is an aggregate (MAX() collapses to one synthetic row with no real row to lock), so
-- `FOR UPDATE` here is invalid SQL. Instead, the transaction opens with
-- `SELECT pg_advisory_xact_lock(hashtext(doctor_user_id || appointment_date))` — a session-level
-- advisory lock keyed on the same (doctor_user_id, appointment_date) pair, held for the lifetime
-- of the transaction and released automatically at COMMIT/ROLLBACK. That advisory lock fully
-- serializes every concurrent transaction that would otherwise race this MAX(token_number) read
-- for the same doctor+day, so no row-level lock is needed or possible here.
-- Defense now has three layers: (1) lockService.js's Redis lock, keyed per (doctor, date, TIME
-- slot), is the first line of defense — it bounds retries before a DB transaction is even
-- opened; (2) the Postgres advisory lock above, keyed per (doctor, date) — coarser than the
-- Redis lock, closing the residual gap where two different time slots for the same doctor/day
-- could otherwise both read MAX(token_number)=0 concurrently; (3) the partial unique index on
-- appointments(doctor_user_id, appointment_date, appointment_time) WHERE status NOT IN
-- ('cancelled', 'no_show') (section 1, above) is the final, unconditional backstop at the
-- database level regardless of what the application layer does or fails to do.
