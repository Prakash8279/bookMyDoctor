-- Doctor Connect — demo/dev seed data, written directly in SQL (using pgcrypto's crypt()/bf to
-- generate real bcrypt hashes) because this sandbox has no network access to npm install the
-- `bcrypt` package prisma/seed.js is meant to use. Passwords hashed here are bcrypt-compatible
-- with Node's `bcrypt.compare()` (pgcrypto's Blowfish implementation is the same algorithm,
-- just historically prefixed $2a$ instead of $2b$ — both verify identically).
--
-- Idempotent: every insert is ON CONFLICT DO NOTHING / DO UPDATE, safe to re-run.
-- Run after 000, 001, 002, 003.

-- Reference data -----------------------------------------------------------

-- NOTE: ids below are real UUIDs (not short slugs like the earlier draft used) — every backend
-- route validates :id-shaped params/query values with isUUID(), so a non-UUID id here would
-- 422 on any request touching these rows. Kept in sync with prisma/seed.js's fixed ids.

INSERT INTO cities (id, name, state) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Mumbai', 'Maharashtra'),
  ('22222222-2222-4222-8222-222222222222', 'Delhi', 'Delhi'),
  ('33333333-3333-4333-8333-333333333333', 'Bangalore', 'Karnataka')
ON CONFLICT (id) DO NOTHING;

INSERT INTO areas (id, city_id, name, pincode) VALUES
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'Andheri West', '400058'),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'Bandra West', '400050')
ON CONFLICT (id) DO NOTHING;

INSERT INTO specializations (id, name, icon, description) VALUES
  ('77777777-7777-4777-8777-777777777777', 'General Physician', 'stethoscope', 'General health checkups and common illnesses'),
  ('88888888-8888-4888-8888-888888888888', 'Cardiologist', 'heart', 'Heart and cardiovascular conditions'),
  ('99999999-9999-4999-8999-999999999999', 'Dermatologist', 'skin', 'Skin, hair, and nail conditions')
ON CONFLICT (id) DO NOTHING;

-- Demo accounts --------------------------------------------------------------
-- Same 5 credentials used across the frontend's demo login buttons.

-- `updated_at` has NO database-level default (Prisma's @updatedAt is application-managed, not a
-- DB default), so a raw SQL INSERT must supply it explicitly or this fails with "null value in
-- column \"updated_at\" violates not-null constraint".
INSERT INTO users (id, email, password_hash, role, name, phone, city, status, updated_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin@connectdoctor.test',        crypt('Admin#DC2026!Test', gen_salt('bf', 10)),      'admin',        'Admin User',        '9000000001', 'Mumbai', 'active', CURRENT_TIMESTAMP),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'superadmin@connectdoctor.test',    crypt('Super#DC2026!Test', gen_salt('bf', 10)),      'superadmin',   'Super Admin',       '9000000002', 'Mumbai', 'active', CURRENT_TIMESTAMP),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'doctor@connectdoctor.test',        crypt('Doctor#DC2026!Test', gen_salt('bf', 10)),     'doctor',       'Dr. Priya Sharma',  '9000000003', 'Mumbai', 'active', CURRENT_TIMESTAMP),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'patient@connectdoctor.test',       crypt('Patient#DC2026!Test', gen_salt('bf', 10)),    'patient',      'Rahul Verma',       '9000000004', 'Mumbai', 'active', CURRENT_TIMESTAMP),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'receptionist@connectdoctor.test',  crypt('Reception#DC2026!Test', gen_salt('bf', 10)),  'receptionist', 'Anita Desai',       '9000000005', 'Mumbai', 'active', CURRENT_TIMESTAMP)
ON CONFLICT (email) DO NOTHING;

INSERT INTO patient_profiles (user_id, gender, address)
VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'male', 'Andheri West, Mumbai')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO doctor_profiles (
  user_id, specialization_id, qualification, registration_number, experience_years,
  consultation_fee, emergency_fee, languages, bio, status, online_booking, emergency_available
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '77777777-7777-4777-8777-777777777777', 'MBBS, MD', 'MH-12345', 8,
  500, 800, ARRAY['English', 'Hindi'], 'General physician with 8 years of experience.',
  'verified', true, true
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO receptionist_profiles (user_id, since)
VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', CURRENT_DATE)
ON CONFLICT (user_id) DO NOTHING;

-- A demo clinic, owned by the demo doctor, staffed by the demo receptionist ---

-- Same reason as the users INSERT above — clinics.updated_at has no DB default either.
INSERT INTO clinics (
  id, name, phone, address, city_id, area_id, approval_status,
  emergency_available, payment_cash_enabled, payment_upi_enabled, updated_at
) VALUES (
  '66666666-6666-4666-8666-666666666666', 'Doctor Connect Demo Clinic', '9000000010', 'Andheri West, Mumbai',
  '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555', 'active', true, true, true, CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO doctor_clinics (doctor_user_id, clinic_id, is_owner, is_primary, online_booking)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '66666666-6666-4666-8666-666666666666', true, true, true)
ON CONFLICT (doctor_user_id, clinic_id) DO NOTHING;

UPDATE receptionist_profiles SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

-- doctor_clinic_hours.id is a plain TEXT primary key with NO database-level default (Prisma
-- generates it application-side via @default(cuid()), never in the DB) — a raw SQL INSERT/SELECT
-- must supply it itself, hence gen_random_uuid()::text per generated row below (pgcrypto must
-- already be created — see 00_full_database_rebuild.sql's header — for gen_random_uuid()).
INSERT INTO doctor_clinic_hours (id, doctor_user_id, clinic_id, weekday, start_time, end_time, slot_minutes)
SELECT gen_random_uuid()::text, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '66666666-6666-4666-8666-666666666666', wd, '10:00', '18:00', 15
FROM generate_series(1, 6) AS wd
ON CONFLICT (doctor_user_id, clinic_id, weekday) DO NOTHING;
