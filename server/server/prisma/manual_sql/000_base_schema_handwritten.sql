-- Doctor Connect — hand-written equivalent of the Prisma-generated base migration.
--
-- WHY THIS FILE EXISTS: this sandbox has no network access to the npm registry, so the Prisma
-- CLI could never be installed here and `npx prisma migrate dev` could never actually run.
-- Everything below is a careful, by-hand SQL translation of prisma/schema.prisma (27 models,
-- 13 enums), written to let the schema be created and sanity-tested against a real local
-- Postgres instance in this sandbox.
--
-- ON THE USER'S OWN MACHINE: once `npm install` can reach the real npm registry, run the real
-- `npx prisma migrate dev --name init` instead of this file — Prisma will generate its own
-- official migration from schema.prisma (and, critically, generate the Prisma Client the
-- application code actually imports, which this file does not and cannot do). This file's
-- purpose is verification here, not a replacement for the real migration there.
--
-- Idempotent: every statement uses IF NOT EXISTS / DROP...CREATE so it's safe to re-run.
-- Run before manual_sql/001, 002, 003 (in that numeric order).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────
-- Enums
-- ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('patient', 'doctor', 'receptionist', 'admin', 'superadmin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountStatus" AS ENUM ('active', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DoctorStatus" AS ENUM ('pending', 'verified', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ClinicApprovalStatus" AS ENUM ('pending', 'active', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM ('upcoming', 'confirmed', 'completed', 'cancelled', 'no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentSource" AS ENUM ('online', 'walk_in');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMode" AS ENUM ('cash', 'upi', 'card', 'online');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "QueueStatus" AS ENUM ('waiting', 'called', 'in_consultation', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ComplaintStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContactStatus" AS ENUM ('open', 'responded', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationAudience" AS ENUM ('all', 'patients', 'doctors', 'receptionists', 'single_user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────
-- Geography (no FKs out, referenced by clinics)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cities (
  id    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name  TEXT NOT NULL,
  state TEXT
);

CREATE TABLE IF NOT EXISTS areas (
  id      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  city_id TEXT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  pincode TEXT
);
CREATE INDEX IF NOT EXISTS areas_city_id_idx ON areas (city_id);

CREATE TABLE IF NOT EXISTS specializations (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL UNIQUE,
  icon        TEXT,
  description TEXT
);

-- ────────────────────────────────────────────────────────────────
-- Auth & Users
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          "UserRole" NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  city          TEXT,
  photo_url     TEXT,
  status        "AccountStatus" NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth     DATE,
  gender            TEXT,
  blood_group       TEXT,
  emergency_contact TEXT,
  address           TEXT,
  medical_history   TEXT,
  about             TEXT
);

-- ────────────────────────────────────────────────────────────────
-- Clinics & Doctor-Clinic (clinics before doctor_profiles/receptionist_profiles
-- would be nice for FK order, but doctor_profiles.specialization_id only needs
-- specializations, already created above — clinics itself only needs cities/areas)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinics (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                 TEXT NOT NULL,
  phone                TEXT,
  address              TEXT,
  city_id              TEXT REFERENCES cities(id),
  area_id              TEXT REFERENCES areas(id),
  approval_status      "ClinicApprovalStatus" NOT NULL DEFAULT 'pending',
  rejection_reason     TEXT,
  emergency_available  BOOLEAN NOT NULL DEFAULT false,
  payment_cash_enabled BOOLEAN NOT NULL DEFAULT true,
  payment_upi_enabled  BOOLEAN NOT NULL DEFAULT false,
  payment_upi_id       TEXT,
  payment_qr_url       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinics_city_id_idx ON clinics (city_id);
CREATE INDEX IF NOT EXISTS clinics_area_id_idx ON clinics (area_id);
CREATE INDEX IF NOT EXISTS clinics_approval_status_idx ON clinics (approval_status);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialization_id      TEXT REFERENCES specializations(id),
  qualification          TEXT,
  registration_number    TEXT,
  experience_years       INTEGER,
  consultation_fee       DECIMAL(10,2) NOT NULL DEFAULT 0,
  emergency_fee          DECIMAL(10,2) NOT NULL DEFAULT 0,
  languages              TEXT[] NOT NULL DEFAULT '{}',
  bio                    TEXT,
  rating                 DECIMAL(3,2) NOT NULL DEFAULT 0,
  review_count           INTEGER NOT NULL DEFAULT 0,
  status                 "DoctorStatus" NOT NULL DEFAULT 'pending',
  verification_documents JSONB,
  online_booking         BOOLEAN NOT NULL DEFAULT true,
  allow_rebooking        BOOLEAN NOT NULL DEFAULT true,
  max_days_advance       INTEGER NOT NULL DEFAULT 30,
  emergency_available    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS doctor_profiles_specialization_id_idx ON doctor_profiles (specialization_id);
CREATE INDEX IF NOT EXISTS doctor_profiles_status_idx ON doctor_profiles (status);

-- receptionist_profiles.clinic_id is added by manual_sql/002 (additive, run after this file).
CREATE TABLE IF NOT EXISTS receptionist_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  since   DATE
);

CREATE TABLE IF NOT EXISTS doctor_clinics (
  doctor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id      TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  is_owner       BOOLEAN NOT NULL DEFAULT false,
  is_primary     BOOLEAN NOT NULL DEFAULT false,
  online_booking BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (doctor_user_id, clinic_id)
);
CREATE INDEX IF NOT EXISTS doctor_clinics_clinic_id_idx ON doctor_clinics (clinic_id);

CREATE TABLE IF NOT EXISTS doctor_clinic_hours (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doctor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id      TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  weekday        INTEGER NOT NULL,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  slot_minutes   INTEGER NOT NULL DEFAULT 15,
  status         TEXT NOT NULL DEFAULT 'active',
  UNIQUE (doctor_user_id, clinic_id, weekday)
);

CREATE TABLE IF NOT EXISTS doctor_clinic_closures (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doctor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id      TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  closed_date    DATE NOT NULL,
  reason         TEXT
);
CREATE INDEX IF NOT EXISTS doctor_clinic_closures_doctor_closed_idx ON doctor_clinic_closures (doctor_user_id, closed_date);

-- ────────────────────────────────────────────────────────────────
-- Family members (needed before appointments)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS family_members (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  relation        TEXT NOT NULL,
  date_of_birth   DATE,
  gender          TEXT,
  blood_group     TEXT
);
CREATE INDEX IF NOT EXISTS family_members_patient_user_id_idx ON family_members (patient_user_id);

-- ────────────────────────────────────────────────────────────────
-- Appointments & Queue
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointments (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_user_id   TEXT NOT NULL REFERENCES users(id),
  family_member_id  TEXT REFERENCES family_members(id) ON DELETE RESTRICT,
  doctor_user_id    TEXT NOT NULL REFERENCES users(id),
  clinic_id         TEXT REFERENCES clinics(id),
  appointment_date  DATE NOT NULL,
  appointment_time  TEXT NOT NULL,
  reason            TEXT,
  is_emergency      BOOLEAN NOT NULL DEFAULT false,
  status            "AppointmentStatus" NOT NULL DEFAULT 'upcoming',
  source            "AppointmentSource" NOT NULL,
  token_number      INTEGER NOT NULL,
  consultation_fee  DECIMAL(10,2) NOT NULL DEFAULT 0,
  convenience_fee   DECIMAL(10,2) NOT NULL DEFAULT 0,
  emergency_fee     DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_status    "PaymentStatus" NOT NULL DEFAULT 'pending',
  payment_method    "PaymentMode",
  checked_in_at     TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_patient_user_id_idx ON appointments (patient_user_id);
CREATE INDEX IF NOT EXISTS appointments_doctor_date_idx ON appointments (doctor_user_id, appointment_date);
CREATE INDEX IF NOT EXISTS appointments_clinic_id_idx ON appointments (clinic_id);
CREATE INDEX IF NOT EXISTS appointments_status_idx ON appointments (status);
CREATE INDEX IF NOT EXISTS appointments_payment_status_idx ON appointments (payment_status);
-- NOTE: the double-booking partial unique index is created by manual_sql/001, run after this file.

CREATE TABLE IF NOT EXISTS queue_tokens (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  doctor_user_id TEXT NOT NULL REFERENCES users(id),
  clinic_id      TEXT REFERENCES clinics(id),
  token_number   INTEGER NOT NULL,
  status         "QueueStatus" NOT NULL DEFAULT 'waiting',
  queue_date     DATE NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_tokens_doctor_date_idx ON queue_tokens (doctor_user_id, queue_date);
CREATE INDEX IF NOT EXISTS queue_tokens_status_idx ON queue_tokens (status);

-- ────────────────────────────────────────────────────────────────
-- Medical Records
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS medical_records (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_user_id TEXT NOT NULL REFERENCES users(id),
  doctor_user_id  TEXT NOT NULL REFERENCES users(id),
  appointment_id  TEXT REFERENCES appointments(id),
  title           TEXT NOT NULL,
  type            TEXT,
  notes           TEXT,
  care_plan       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medical_records_patient_user_id_idx ON medical_records (patient_user_id);
CREATE INDEX IF NOT EXISTS medical_records_doctor_user_id_idx ON medical_records (doctor_user_id);

-- ────────────────────────────────────────────────────────────────
-- Payments & Revenue
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receipt_number   TEXT NOT NULL UNIQUE,
  appointment_id   TEXT REFERENCES appointments(id),
  patient_user_id  TEXT NOT NULL REFERENCES users(id),
  doctor_user_id   TEXT NOT NULL REFERENCES users(id),
  clinic_id        TEXT REFERENCES clinics(id),
  consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  convenience_fee  DECIMAL(10,2) NOT NULL DEFAULT 0,
  emergency_fee    DECIMAL(10,2) NOT NULL DEFAULT 0,
  gst_amount       DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount           DECIMAL(10,2) NOT NULL,
  mode             "PaymentMode" NOT NULL,
  transaction_ref  TEXT,
  status           "PaymentStatus" NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_patient_user_id_idx ON payments (patient_user_id);
CREATE INDEX IF NOT EXISTS payments_doctor_user_id_idx ON payments (doctor_user_id);
CREATE INDEX IF NOT EXISTS payments_clinic_id_idx ON payments (clinic_id);
CREATE INDEX IF NOT EXISTS payments_appointment_id_idx ON payments (appointment_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

-- Singleton config tables — CHECK(id=1) constraint added by manual_sql/001, which also seeds them.
CREATE TABLE IF NOT EXISTS platform_charges (
  id                       INTEGER PRIMARY KEY DEFAULT 1,
  commission_percent       DECIMAL(5,2) NOT NULL DEFAULT 10,
  patient_convenience_fee  DECIMAL(10,2) NOT NULL DEFAULT 25,
  emergency_fee            DECIMAL(10,2) NOT NULL DEFAULT 50,
  gst_percent              DECIMAL(5,2) NOT NULL DEFAULT 18,
  apply_convenience_fee    BOOLEAN NOT NULL DEFAULT true,
  apply_emergency_fee      BOOLEAN NOT NULL DEFAULT true,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────
-- Reviews & Moderation
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id),
  doctor_user_id TEXT NOT NULL REFERENCES users(id),
  patient_user_id TEXT NOT NULL REFERENCES users(id),
  rating         INTEGER NOT NULL,
  text           TEXT,
  status         "ReviewStatus" NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_doctor_status_idx ON reviews (doctor_user_id, status);

-- ────────────────────────────────────────────────────────────────
-- Notifications
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'system',
  sender_user_id TEXT REFERENCES users(id),
  audience       "NotificationAudience" NOT NULL DEFAULT 'single_user',
  target_user_id TEXT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ,
  UNIQUE (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS notification_recipients_user_read_idx ON notification_recipients (user_id, read_at);

-- ────────────────────────────────────────────────────────────────
-- Complaints & Contact
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS complaints (
  raised_by_user_id TEXT NOT NULL REFERENCES users(id),
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  subject           TEXT NOT NULL,
  description       TEXT,
  status            "ComplaintStatus" NOT NULL DEFAULT 'open',
  admin_response    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaints_raised_by_user_id_idx ON complaints (raised_by_user_id);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints (status);

CREATE TABLE IF NOT EXISTS contact_requests (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     "ContactStatus" NOT NULL DEFAULT 'open',
  response   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_requests_status_idx ON contact_requests (status);

-- ────────────────────────────────────────────────────────────────
-- Platform Admin
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_settings (
  id               INTEGER PRIMARY KEY DEFAULT 1,
  platform_name    TEXT NOT NULL DEFAULT 'Doctor Connect',
  support_email    TEXT,
  support_phone    TEXT,
  booking_fee      DECIMAL(10,2) NOT NULL DEFAULT 0,
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_rules (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 2,
  max_bookings_per_patient  INTEGER NOT NULL DEFAULT 5,
  default_slot_minutes      INTEGER NOT NULL DEFAULT 15,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_user_id      TEXT REFERENCES users(id),
  actor_role         TEXT,
  action_type        TEXT NOT NULL,
  target_entity_type TEXT,
  target_entity_id   TEXT,
  description        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_log_actor_user_id_idx ON activity_log (actor_user_id);
CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log (created_at);
