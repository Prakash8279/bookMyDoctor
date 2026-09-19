-- =============================================================================
-- reset_test_data.sql
--
-- Safely clears test/dummy appointment, payment, and review data from the
-- BookMyDoctor24 database WITHOUT touching any login account — doctor,
-- patient, receptionist, admin, and superadmin demo credentials are all left
-- exactly as they are. This script never references the `users` table at all.
--
-- WHY THIS EXISTS: pasting a fresh ad-hoc DELETE into pgAdmin every time the
-- dev database accumulates test bookings is error-prone (easy to forget a
-- table, get the foreign-key order wrong, or skip taking a backup first).
-- This is the single, reviewed, reusable way to do it — keep it, don't
-- recreate it from scratch next time.
--
-- ─────────────────────────────────────────────────────────────────────────
-- HOW TO USE
-- ─────────────────────────────────────────────────────────────────────────
--   1. BACK UP FIRST. From your own terminal (not this file):
--        pg_dump "<your DATABASE_URL>" -t appointments -t payments -t reviews -f backup_before_reset.sql
--      Keep that file until you're sure you don't need anything from it.
--
--   2. Pick TIME-SCOPED or FULL WIPE (see "SCOPE" below) and edit the cutoff
--      date if using time-scoped mode. Time-scoped is the safer default —
--      it only removes rows created after the date you set, so anything
--      older (real bookings, earlier legitimate test fixtures you still
--      want) is left untouched.
--
--   3. Run the whole file:
--        psql "<your DATABASE_URL>" -f server/server/scripts/reset_test_data.sql
--      ...or paste the entire block into pgAdmin's Query Tool and execute it
--      as one script (the toolbar's "Execute Script" / F5).
--
--   4. Read the final SELECT's output. If a count looks wrong (e.g.
--      users_untouched changed, or appointments_left isn't what you
--      expected), you still have the backup from step 1 to restore from.
--      For an extra safety net, run this interactively instead: open
--      `psql "<your DATABASE_URL>"` yourself, paste everything up to (not
--      including) COMMIT, inspect the SELECT output, then type COMMIT or
--      ROLLBACK by hand. Running via `psql -f` or pgAdmin's single-script
--      execute commits automatically at the end.
--
-- WHAT THIS NEVER TOUCHES: users, patient_profiles, doctor_profiles,
-- receptionist_profiles, clinics, cities, specializations, platform_charges,
-- booking_rules, system_settings, medical_records (their appointment_id just
-- gets set to NULL per the schema's ON DELETE SET NULL — the records
-- themselves are never removed by this script).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- SCOPE — edit this date, or switch to FULL WIPE mode
-- ─────────────────────────────────────────────────────────────────────────
-- Every DELETE below is time-scoped by default: only rows on an appointment
-- created on/after this timestamp are removed. Change the date to whatever
-- "start of my test session" actually was.
--
-- To do a FULL WIPE instead (every appointment/payment/review, regardless of
-- date), comment out the three time-scoped DELETEs below and uncomment the
-- three "-- FULL WIPE:" lines instead.

-- ── Step 0 (optional but recommended): preview counts before deleting anything ──
SELECT COUNT(*) AS appointments_that_will_be_deleted
FROM appointments WHERE created_at >= '2026-09-18 00:00:00';

-- ── Step 1: Reviews first. review.appointment_id is NOT NULL with an
--    ON DELETE RESTRICT foreign key, so a reviewed appointment can't be
--    deleted while its review still exists. ──
DELETE FROM reviews WHERE appointment_id IN (
  SELECT id FROM appointments WHERE created_at >= '2026-09-18 00:00:00'
);
-- FULL WIPE: DELETE FROM reviews;

-- ── Step 2: Payments (includes standalone/counter payments with no
--    appointment link, since those are test data too). ──
DELETE FROM payments WHERE appointment_id IN (
  SELECT id FROM appointments WHERE created_at >= '2026-09-18 00:00:00'
) OR appointment_id IS NULL;
-- FULL WIPE: DELETE FROM payments;

-- ── Step 3: Appointments. queue_tokens for these cascade-delete
--    automatically; any medical_records pointing at these just have their
--    appointment_id set to NULL (the records themselves are kept). ──
DELETE FROM appointments WHERE created_at >= '2026-09-18 00:00:00';
-- FULL WIPE: DELETE FROM appointments;

-- ── Step 4: Verify before trusting the COMMIT below ──
SELECT
  (SELECT COUNT(*) FROM appointments) AS appointments_left,
  (SELECT COUNT(*) FROM payments)     AS payments_left,
  (SELECT COUNT(*) FROM reviews)      AS reviews_left,
  (SELECT COUNT(*) FROM queue_tokens) AS queue_tokens_left,
  (SELECT COUNT(*) FROM users)        AS users_untouched; -- should equal your pre-run count

COMMIT;
