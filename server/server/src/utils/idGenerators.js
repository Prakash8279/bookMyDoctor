/**
 * Server-side generators for human-facing sequential ids (payment receipt numbers, booking ids)
 * that must be unique and monotonic — backed by a Postgres SEQUENCE, never Math.random()/array-index
 * like the current frontend does. Responsibility: one place that talks to the DB sequence.
 */
const prisma = require('../config/db');

/**
 * Draws the next value from the `payment_receipt_seq` Postgres sequence (created in
 * prisma/manual_sql/001_constraints_and_triggers.sql) and formats it as CDR-00000001.
 * Every call returns a distinct, monotonically increasing number — safe under concurrency
 * because Postgres sequences are atomic, no application-level locking needed.
 * @returns {Promise<string>}
 */
async function nextReceiptNumber(client = prisma) {
  const rows = await client.$queryRaw`SELECT nextval('payment_receipt_seq') AS value`;
  const value = rows[0].value; // BigInt from node-postgres
  return `CDR-${value.toString().padStart(8, '0')}`;
}

/**
 * Draws the next value from `patient_number_seq` (created in prisma/migrations/
 * 20260919130000_add_patient_doctor_clinic_numbers) as a plain integer — unlike
 * nextReceiptNumber above, no prefix/padding is applied here, because the display prefix
 * ("DCP") is a presentation concern the frontend owns (client/src/lib/format.js), not something
 * to bake into the stored number itself. Called once, at registration, and the result is stored
 * forever on User.patientNumber — never recomputed, never re-derived from list position.
 * @param {import('@prisma/client').PrismaClient} [client=prisma]
 * @returns {Promise<number>}
 */
async function nextPatientNumber(client = prisma) {
  const rows = await client.$queryRaw`SELECT nextval('patient_number_seq') AS value`;
  return Number(rows[0].value); // BigInt from node-postgres
}

/**
 * Same pattern as nextPatientNumber, backed by `doctor_number_seq`, stored on
 * DoctorProfile.doctorNumber. Called once, at doctor creation.
 * @param {import('@prisma/client').PrismaClient} [client=prisma]
 * @returns {Promise<number>}
 */
async function nextDoctorNumber(client = prisma) {
  const rows = await client.$queryRaw`SELECT nextval('doctor_number_seq') AS value`;
  return Number(rows[0].value);
}

/**
 * Same pattern as nextPatientNumber, backed by `clinic_number_seq`, stored on
 * Clinic.clinicNumber. Called once, at clinic creation.
 * @param {import('@prisma/client').PrismaClient} [client=prisma]
 * @returns {Promise<number>}
 */
async function nextClinicNumber(client = prisma) {
  const rows = await client.$queryRaw`SELECT nextval('clinic_number_seq') AS value`;
  return Number(rows[0].value);
}

module.exports = { nextReceiptNumber, nextPatientNumber, nextDoctorNumber, nextClinicNumber };
