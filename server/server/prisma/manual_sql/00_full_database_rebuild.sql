-- ════════════════════════════════════════════════════════════════════════
-- Doctor Connect — FULL DATABASE REBUILD (single file)
--
-- Use this when the database was dropped / deleted and needs to be
-- recreated from scratch. Combines, in the correct order, everything that
-- was previously five separate files:
--   1) Prisma's own generated schema migration (all enums + tables)
--   2) manual_sql/001_constraints_and_triggers.sql  (audit fix already applied:
--      no-show appointments no longer permanently block their slot)
--   3) manual_sql/002_receptionist_clinic_id.sql
--   4) manual_sql/003_family_member_fk_restrict.sql
--   5) manual_sql/seed_demo_data.sql (demo cities/areas/clinic/5 accounts —
--      already uses real UUIDs, so manual_sql/004_fix_seed_uuid_ids.sql is
--      NOT needed here — that script was only for migrating an already-live
--      database that had old slug-style ids; a fresh rebuild never has them)
--
-- HOW TO RUN: open this file in pgAdmin's Query Tool (folder icon → select
-- this file) against your empty/target database, then press ▶ / F5 once.
-- Every statement here is idempotent (IF NOT EXISTS / ON CONFLICT / DROP+CREATE),
-- so it is also safe to run again later if needed.
--
-- AFTER RUNNING — one extra terminal step, so Prisma's own migration
-- history matches reality (skip this and a later `npx prisma migrate dev`
-- may try to re-apply the initial migration and fail):
--   cd server/server
--   npx prisma migrate resolve --applied 20260823180301_init
--
-- (Alternative, if you'd rather let Prisma create the schema itself instead
-- of section 1 below: run `npx prisma migrate dev` from server/server first,
-- then run just sections 2-5 of this file. Either path ends in the same
-- place.)
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────
-- SECTION 1 of 5 — Prisma-generated schema (enums + tables)
-- source: prisma/migrations/20260823180301_init/migration.sql
-- ────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('patient', 'doctor', 'receptionist', 'admin', 'superadmin');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('pending', 'verified', 'disabled');

-- CreateEnum
CREATE TYPE "ClinicApprovalStatus" AS ENUM ('pending', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('upcoming', 'confirmed', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('online', 'walk_in');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('cash', 'upi', 'card', 'online');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('waiting', 'called', 'in_consultation', 'completed');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('open', 'responded', 'resolved');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('all', 'patients', 'doctors', 'receptionists', 'single_user');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "photo_url" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "user_id" TEXT NOT NULL,
    "date_of_birth" DATE,
    "gender" TEXT,
    "blood_group" TEXT,
    "emergency_contact" TEXT,
    "address" TEXT,
    "medical_history" TEXT,
    "about" TEXT,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "doctor_profiles" (
    "user_id" TEXT NOT NULL,
    "specialization_id" TEXT,
    "qualification" TEXT,
    "registration_number" TEXT,
    "experience_years" INTEGER,
    "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "status" "DoctorStatus" NOT NULL DEFAULT 'pending',
    "verification_documents" JSONB,
    "online_booking" BOOLEAN NOT NULL DEFAULT true,
    "allow_rebooking" BOOLEAN NOT NULL DEFAULT true,
    "max_days_advance" INTEGER NOT NULL DEFAULT 30,
    "emergency_available" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "doctor_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "receptionist_profiles" (
    "user_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "since" DATE,

    CONSTRAINT "receptionist_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "clinics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city_id" TEXT,
    "area_id" TEXT,
    "approval_status" "ClinicApprovalStatus" NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "emergency_available" BOOLEAN NOT NULL DEFAULT false,
    "payment_cash_enabled" BOOLEAN NOT NULL DEFAULT true,
    "payment_upi_enabled" BOOLEAN NOT NULL DEFAULT false,
    "payment_upi_id" TEXT,
    "payment_qr_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_clinics" (
    "doctor_user_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "online_booking" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "doctor_clinics_pkey" PRIMARY KEY ("doctor_user_id","clinic_id")
);

-- CreateTable
CREATE TABLE "doctor_clinic_hours" (
    "id" TEXT NOT NULL,
    "doctor_user_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "slot_minutes" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "doctor_clinic_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_clinic_closures" (
    "id" TEXT NOT NULL,
    "doctor_user_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "closed_date" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "doctor_clinic_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pincode" TEXT,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specializations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,

    CONSTRAINT "specializations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "patient_user_id" TEXT NOT NULL,
    "family_member_id" TEXT,
    "doctor_user_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "appointment_date" DATE NOT NULL,
    "appointment_time" TEXT NOT NULL,
    "reason" TEXT,
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'upcoming',
    "source" "AppointmentSource" NOT NULL,
    "token_number" INTEGER NOT NULL,
    "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "convenience_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "payment_method" "PaymentMode",
    "checked_in_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_tokens" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "doctor_user_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "token_number" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'waiting',
    "queue_date" DATE NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" TEXT NOT NULL,
    "patient_user_id" TEXT NOT NULL,
    "doctor_user_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "notes" TEXT,
    "care_plan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "patient_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "date_of_birth" DATE,
    "gender" TEXT,
    "blood_group" TEXT,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "appointment_id" TEXT,
    "patient_user_id" TEXT NOT NULL,
    "doctor_user_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "convenience_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gst_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(10,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "transaction_ref" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_charges" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "commission_percent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "patient_convenience_fee" DECIMAL(10,2) NOT NULL DEFAULT 25,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 50,
    "gst_percent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "apply_convenience_fee" BOOLEAN NOT NULL DEFAULT true,
    "apply_emergency_fee" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "doctor_user_id" TEXT NOT NULL,
    "patient_user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'system',
    "sender_user_id" TEXT,
    "audience" "NotificationAudience" NOT NULL DEFAULT 'single_user',
    "target_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_recipients" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "raised_by_user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'open',
    "admin_response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'open',
    "response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "platform_name" TEXT NOT NULL DEFAULT 'Doctor Connect',
    "support_email" TEXT,
    "support_phone" TEXT,
    "booking_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_rules" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cancellation_window_hours" INTEGER NOT NULL DEFAULT 2,
    "max_bookings_per_patient" INTEGER NOT NULL DEFAULT 5,
    "default_slot_minutes" INTEGER NOT NULL DEFAULT 15,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_role" TEXT,
    "action_type" TEXT NOT NULL,
    "target_entity_type" TEXT,
    "target_entity_id" TEXT,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "doctor_profiles_specialization_id_idx" ON "doctor_profiles"("specialization_id");

-- CreateIndex
CREATE INDEX "doctor_profiles_status_idx" ON "doctor_profiles"("status");

-- CreateIndex
CREATE INDEX "receptionist_profiles_clinic_id_idx" ON "receptionist_profiles"("clinic_id");

-- CreateIndex
CREATE INDEX "clinics_city_id_idx" ON "clinics"("city_id");

-- CreateIndex
CREATE INDEX "clinics_area_id_idx" ON "clinics"("area_id");

-- CreateIndex
CREATE INDEX "clinics_approval_status_idx" ON "clinics"("approval_status");

-- CreateIndex
CREATE INDEX "doctor_clinics_clinic_id_idx" ON "doctor_clinics"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_clinic_hours_doctor_user_id_clinic_id_weekday_key" ON "doctor_clinic_hours"("doctor_user_id", "clinic_id", "weekday");

-- CreateIndex
CREATE INDEX "doctor_clinic_closures_doctor_user_id_closed_date_idx" ON "doctor_clinic_closures"("doctor_user_id", "closed_date");

-- CreateIndex
CREATE INDEX "areas_city_id_idx" ON "areas"("city_id");

-- CreateIndex
CREATE UNIQUE INDEX "specializations_name_key" ON "specializations"("name");

-- CreateIndex
CREATE INDEX "appointments_patient_user_id_idx" ON "appointments"("patient_user_id");

-- CreateIndex
CREATE INDEX "appointments_doctor_user_id_appointment_date_idx" ON "appointments"("doctor_user_id", "appointment_date");

-- CreateIndex
CREATE INDEX "appointments_clinic_id_idx" ON "appointments"("clinic_id");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "appointments_payment_status_idx" ON "appointments"("payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tokens_appointment_id_key" ON "queue_tokens"("appointment_id");

-- CreateIndex
CREATE INDEX "queue_tokens_doctor_user_id_queue_date_idx" ON "queue_tokens"("doctor_user_id", "queue_date");

-- CreateIndex
CREATE INDEX "queue_tokens_status_idx" ON "queue_tokens"("status");

-- CreateIndex
CREATE INDEX "medical_records_patient_user_id_idx" ON "medical_records"("patient_user_id");

-- CreateIndex
CREATE INDEX "medical_records_doctor_user_id_idx" ON "medical_records"("doctor_user_id");

-- CreateIndex
CREATE INDEX "family_members_patient_user_id_idx" ON "family_members"("patient_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receipt_number_key" ON "payments"("receipt_number");

-- CreateIndex
CREATE INDEX "payments_patient_user_id_idx" ON "payments"("patient_user_id");

-- CreateIndex
CREATE INDEX "payments_doctor_user_id_idx" ON "payments"("doctor_user_id");

-- CreateIndex
CREATE INDEX "payments_clinic_id_idx" ON "payments"("clinic_id");

-- CreateIndex
CREATE INDEX "payments_appointment_id_idx" ON "payments"("appointment_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_appointment_id_key" ON "reviews"("appointment_id");

-- CreateIndex
CREATE INDEX "reviews_doctor_user_id_status_idx" ON "reviews"("doctor_user_id", "status");

-- CreateIndex
CREATE INDEX "notification_recipients_user_id_read_at_idx" ON "notification_recipients"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipients_notification_id_user_id_key" ON "notification_recipients"("notification_id", "user_id");

-- CreateIndex
CREATE INDEX "complaints_raised_by_user_id_idx" ON "complaints"("raised_by_user_id");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "contact_requests_status_idx" ON "contact_requests"("status");

-- CreateIndex
CREATE INDEX "activity_log_actor_user_id_idx" ON "activity_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "activity_log_created_at_idx" ON "activity_log"("created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_specialization_id_fkey" FOREIGN KEY ("specialization_id") REFERENCES "specializations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptionist_profiles" ADD CONSTRAINT "receptionist_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptionist_profiles" ADD CONSTRAINT "receptionist_profiles_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinics" ADD CONSTRAINT "doctor_clinics_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinics" ADD CONSTRAINT "doctor_clinics_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinic_hours" ADD CONSTRAINT "doctor_clinic_hours_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinic_hours" ADD CONSTRAINT "doctor_clinic_hours_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinic_closures" ADD CONSTRAINT "doctor_clinic_closures_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_clinic_closures" ADD CONSTRAINT "doctor_clinic_closures_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tokens" ADD CONSTRAINT "queue_tokens_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────
-- SECTION 2 of 5 — constraints, triggers, singleton config rows
-- source: prisma/manual_sql/001_constraints_and_triggers.sql (fixed version:
-- no-show appointments now correctly release their slot)
-- ────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────
-- SECTION 3 of 5 — receptionist.clinic_id column
-- source: prisma/manual_sql/002_receptionist_clinic_id.sql
-- ────────────────────────────────────────────────────────────────

-- Doctor Connect — additive supplement for the Directory & Reference Data phase.
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE — see the comment on `ReceptionistProfile.clinicId` in
-- prisma/schema.prisma for full rationale. Short version: DATABASE_SCHEMA.md §2 says receptionist
-- clinic-assignment "lives in `clinic_staff` below", but that table was never actually defined —
-- an authoring gap, not a deliberate decision to leave receptionists unscoped to a clinic. This
-- phase's brief explicitly requires a receptionist to be "tied to a specific clinic", which has
-- no schema-legal, non-hacky implementation without a queryable clinic_id column somewhere.
--
-- This statement is purely additive (new nullable column + index + FK — nothing existing is
-- renamed, retyped, or dropped) and is normally what `npx prisma migrate dev --name
-- add_receptionist_clinic` would generate from the schema.prisma edit made alongside this file.
-- It is captured here, by hand, because this environment has no DB/network access to actually
-- run `prisma migrate dev`. Run this AFTER the Prisma-generated migration for the rest of the
-- schema has been applied, and treat it as needing the same explicit review/sign-off as any
-- other schema change before it touches a real database.
--
-- Idempotent (safe to re-run) via IF NOT EXISTS.

-- clinic_id is TEXT, not UUID: every id in this schema is Prisma's plain `String @default(uuid())`
-- (no `@db.Uuid`), which maps to a Postgres TEXT/VARCHAR column, not the native `uuid` type — so
-- the FK target (clinics.id) is TEXT and this column must match or the constraint cannot be
-- created at all ("incompatible types: uuid and text"). Caught by hand-applying this file against
-- a real local Postgres instance in the sandbox this was built in; verify again if you ever add a
-- genuinely native-uuid-typed id anywhere in this schema.
ALTER TABLE receptionist_profiles
  ADD COLUMN IF NOT EXISTS clinic_id TEXT REFERENCES clinics(id);

CREATE INDEX IF NOT EXISTS receptionist_profiles_clinic_id_idx
  ON receptionist_profiles (clinic_id);

-- ────────────────────────────────────────────────────────────────
-- SECTION 4 of 5 — family_member_id FK restrict fix
-- source: prisma/manual_sql/003_family_member_fk_restrict.sql
-- ────────────────────────────────────────────────────────────────

-- Doctor Connect — fix for a HIGH-severity finding on appointments.family_member_id's FK.
--
-- Prisma's default onDelete for an OPTIONAL relation (appointments.family_member_id is
-- nullable) is SetNull, not Postgres' own bare-FK default of NO ACTION/RESTRICT. If this FK was
-- ever created — by `prisma db push`, or by an earlier `prisma migrate dev` — from the
-- schema.prisma revision that had no explicit `onDelete` on Appointment.familyMember, Postgres
-- would already have "ON DELETE SET NULL" wired up, and familyMembers.service.js's
-- deleteFamilyMember (which relies on catching a Prisma P2003 foreign-key-violation error to
-- return a clean 409 FAMILY_MEMBER_HAS_APPOINTMENTS) would never see that error: the delete
-- would just succeed and silently null out appointments.family_member_id on every appointment
-- that referenced the deleted family member.
--
-- schema.prisma now declares `onDelete: Restrict` explicitly on that relation (see the comment
-- there). This statement makes an already-created database match that declaration by hand, the
-- same way manual_sql/002_receptionist_clinic_id.sql hand-applies its own schema.prisma edit —
-- run it in this environment because there is no DB/network access here to run
-- `prisma migrate dev` and let Prisma generate + apply the real migration itself. Needs the same
-- explicit review/sign-off as any other schema/constraint change before touching a real
-- database, and should ideally be superseded by a proper Prisma migration once DB access exists.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + a fresh ADD CONSTRAINT is safe to re-run, and the
-- constraint name matches Prisma's default naming convention for Postgres
-- ("{table}_{column}_fkey") so this lines up with what `prisma migrate dev` would have named it.

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_family_member_id_fkey;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_family_member_id_fkey
  FOREIGN KEY (family_member_id) REFERENCES family_members (id)
  ON DELETE RESTRICT;

-- ────────────────────────────────────────────────────────────────
-- SECTION 5 of 5 — demo seed data (5 demo accounts, 1 clinic, ref data)
-- source: prisma/manual_sql/seed_demo_data.sql (already uses real UUIDs)
-- ────────────────────────────────────────────────────────────────

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
-- DB default — see the CREATE TABLE "users" block above: created_at has DEFAULT CURRENT_TIMESTAMP
-- but updated_at does not), so a raw SQL INSERT must supply it explicitly or this fails with
-- "null value in column \"updated_at\" violates not-null constraint".
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
-- must supply it itself, hence gen_random_uuid()::text per generated row below (pgcrypto is
-- already created at the top of this script).
INSERT INTO doctor_clinic_hours (id, doctor_user_id, clinic_id, weekday, start_time, end_time, slot_minutes)
SELECT gen_random_uuid()::text, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '66666666-6666-4666-8666-666666666666', wd, '10:00', '18:00', 15
FROM generate_series(1, 6) AS wd
ON CONFLICT (doctor_user_id, clinic_id, weekday) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- Done. Verify with:
--   SELECT count(*) FROM users;              -- expect 5 (the demo accounts)
--   SELECT count(*) FROM clinics;             -- expect 1
--   SELECT email, role FROM users ORDER BY role;
-- ════════════════════════════════════════════════════════════════════════
