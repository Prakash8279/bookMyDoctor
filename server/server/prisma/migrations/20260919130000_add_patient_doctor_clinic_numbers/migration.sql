-- BookMyDoctor24 — stable, sequential, human-facing display numbers for patients, doctors, and
-- clinics ("DCP1, DCP2, ...", "DCD1, DCD2, ...", "DCC1, DCC2, ..."), replacing the earlier
-- position-based sequenceId() display (client/src/lib/format.js) for the three tables that
-- represent PATIENT/DOCTOR/CLINIC records themselves.
--
-- WHY THIS EXISTS: sequenceId() derives its "DC01, DC02..." number from a row's 0-based index in
-- whatever filtered/sorted/paginated array happens to be rendered right now — perfectly fine for
-- generic on-screen row numbering, but wrong for something meant to identify one specific
-- patient/doctor/clinic wherever their data appears (the same patient must show the same DCP
-- number on every screen, at every page/search/sort state, forever). That requires a real stored
-- value, assigned once, never recomputed — hence this migration.
--
-- SHAPE: one Postgres SEQUENCE + one nullable UNIQUE INTEGER column per table, mirroring the
-- existing payment_receipt_seq / payments.receipt_number pattern from
-- manual_sql/001_constraints_and_triggers.sql (see idGenerators.js for how that one is consumed).
-- Nullable because a plain Postgres UNIQUE index already treats every NULL as distinct (no two
-- NULLs conflict), so no partial-index trick is needed — this matches exactly what Prisma's
-- `Int? @unique` generates, keeping schema.prisma and this hand-written SQL in agreement.
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS or is safe to re-run (backfill only touches rows
-- still NULL; setval is safe to call repeatedly). Safe against a database that already has this
-- from a partial/retried run, and safe against a brand-new database.

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. Sequences
-- ════════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS patient_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS doctor_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS clinic_number_seq START WITH 1 INCREMENT BY 1;

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. Columns
-- ════════════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_number INTEGER;
ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS doctor_number INTEGER;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS clinic_number INTEGER;

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. Backfill existing rows, oldest-first (registration/creation order), only where still NULL
-- ════════════════════════════════════════════════════════════════════════════════

-- Patients: every users row with role='patient'. Ties on created_at broken by id for a
-- deterministic, repeatable order.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM users
  WHERE role = 'patient' AND patient_number IS NULL
)
UPDATE users u SET patient_number = ranked.rn
FROM ranked
WHERE u.id = ranked.id;

-- Doctors: ordered by the linked user's created_at (a doctor_profiles row has no created_at of
-- its own — it shares its user's registration timestamp).
WITH ranked AS (
  SELECT dp.user_id, ROW_NUMBER() OVER (ORDER BY u.created_at, dp.user_id) AS rn
  FROM doctor_profiles dp
  JOIN users u ON u.id = dp.user_id
  WHERE dp.doctor_number IS NULL
)
UPDATE doctor_profiles dp SET doctor_number = ranked.rn
FROM ranked
WHERE dp.user_id = ranked.user_id;

-- Clinics: ordered by their own created_at.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM clinics
  WHERE clinic_number IS NULL
)
UPDATE clinics c SET clinic_number = ranked.rn
FROM ranked
WHERE c.id = ranked.id;

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. Advance each sequence past whatever the backfill just assigned, so the very next
--    nextval() call (the next real registration/creation) continues right after it instead of
--    colliding with a backfilled number. `is_called = false` means the next nextval() returns
--    this value itself, not this value + 1.
-- ════════════════════════════════════════════════════════════════════════════════

SELECT setval('patient_number_seq', COALESCE((SELECT MAX(patient_number) FROM users), 0) + 1, false);
SELECT setval('doctor_number_seq', COALESCE((SELECT MAX(doctor_number) FROM doctor_profiles), 0) + 1, false);
SELECT setval('clinic_number_seq', COALESCE((SELECT MAX(clinic_number) FROM clinics), 0) + 1, false);

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. Uniqueness — added after backfill so it never fails against pre-existing data. Named to
--    match exactly what Prisma's `Int? @unique @map(...)` generates for these columns, so
--    schema.prisma and this hand-written SQL never drift apart.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS users_patient_number_key ON users (patient_number);
CREATE UNIQUE INDEX IF NOT EXISTS doctor_profiles_doctor_number_key ON doctor_profiles (doctor_number);
CREATE UNIQUE INDEX IF NOT EXISTS clinics_clinic_number_key ON clinics (clinic_number);
