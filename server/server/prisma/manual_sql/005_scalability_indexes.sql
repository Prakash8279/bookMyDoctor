-- Doctor Connect — scalability pass: indexes for sort/search paths that had none.
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE — see the matching comments on DoctorProfile and
-- Appointment in prisma/schema.prisma for the full rationale. Short version, two unrelated gaps
-- found while reading the query code:
--
--   1. doctors.service.js#listDoctors lets the caller sort the public doctor directory by
--      sortBy=rating|fee|experience (SORT_FIELD_MAP maps those to doctor_profiles.rating /
--      consultation_fee / experience_years). None of those three columns had a supporting index,
--      so every sorted directory page — the common case, not an edge case — forced Postgres to
--      sort the entire doctor_profiles table instead of walking an index in order.
--
--   2. appointments.service.js#listAppointments's admin/superadmin path (the only role allowed to
--      query with no doctorId/clinicId/patientId filter — see the role-scoping block in that
--      function) orders by [{appointmentDate:'desc'},{appointmentTime:'desc'}] with no filter at
--      all in the common "recent appointments" view. The existing (doctor_user_id,
--      appointment_date) composite index only helps once a doctor filter narrows the row set
--      first, so this unfiltered admin query had nothing to lean on.
--
--   3. Both doctors.service.js (search on the doctor's linked User.name) and clinics.service.js
--      (search on Clinic.name) do a leading-wildcard case-insensitive search —
--      `{ name: { contains: search, mode: 'insensitive' } }` — which Prisma compiles to
--      `ILIKE '%term%'`. A plain btree index cannot serve that pattern (the leading `%` defeats
--      left-anchored index scans), so these searches were always sequential scans over users/
--      clinics. Postgres's pg_trgm extension supports arbitrary-substring ILIKE via a GIN
--      trigram index, which is the standard fix for this exact shape of query.
--
-- These are pure DSL documentation in schema.prisma (Prisma's schema DSL has no way to express a
-- GIN/trigram index at all, and this sandbox has no DB/network access to run
-- `npx prisma migrate dev`), so the actual index creation is captured here, by hand, same as
-- 001-004. Run this by hand via psql or pgAdmin's Query Tool against the real database, AFTER the
-- Prisma-generated schema (and 001-004) already exist — the pg_trgm indexes below reference
-- users(name) and clinics(name), so those tables must already exist.
--
-- Idempotent (safe to re-run): every statement uses IF NOT EXISTS, and CREATE EXTENSION IF NOT
-- EXISTS is itself idempotent. Building a GIN trigram index locks out writes to the target table
-- for the duration on a large table CREATE INDEX CONCURRENTLY would avoid that, but is not used
-- here to stay consistent with 001-004's plain CREATE INDEX IF NOT EXISTS style and because it
-- cannot run inside a transaction block — apply during a low-traffic window on a live database
-- with real data volume.

-- (1) Directory sort columns on doctor_profiles — backs doctors.service.js's
-- sortBy=rating|fee|experience directory queries.
CREATE INDEX IF NOT EXISTS doctor_profiles_rating_idx
  ON doctor_profiles (rating);

CREATE INDEX IF NOT EXISTS doctor_profiles_consultation_fee_idx
  ON doctor_profiles (consultation_fee);

CREATE INDEX IF NOT EXISTS doctor_profiles_experience_years_idx
  ON doctor_profiles (experience_years);

-- (2) Unfiltered admin "recent appointments" view — backs
-- appointments.service.js#listAppointments's orderBy [{appointmentDate:'desc'},
-- {appointmentTime:'desc'}] when admin/superadmin passes no doctorId/clinicId/patientId.
CREATE INDEX IF NOT EXISTS appointments_date_time_idx
  ON appointments (appointment_date, appointment_time);

-- (3) Trigram GIN indexes for leading-wildcard ILIKE name search.
-- pg_trgm ships with core Postgres (contrib module) — no external download needed, just enabling
-- it on this database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- doctors.service.js#listDoctors: `where.doctor = { name: { contains: search, mode: 'insensitive' } }`
-- resolves against the User row backing the doctor (users.name), not doctor_profiles.
CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING gin (name gin_trgm_ops);

-- clinics.service.js#listClinics: `{ name: { contains: search, mode: 'insensitive' } }` on Clinic.
CREATE INDEX IF NOT EXISTS clinics_name_trgm_idx
  ON clinics USING gin (name gin_trgm_ops);
