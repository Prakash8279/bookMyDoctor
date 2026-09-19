-- BookMyDoctor24 — doctor UPI ID (admin/superadmin-only), alongside the existing bank fields.
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE, same reason 001-008 are hand-written: this sandbox has
-- no DB/network access to run `npx prisma migrate dev`. Run this by hand via psql/pgAdmin
-- against the real database (no ordering dependency on 007/008 — this only adds one more
-- nullable column to doctor_profiles).
--
-- Context (request: "upiid dalne ka v option de do"): one nullable column, independent of the 4
-- bank fields 007 already added — a doctor may fill in bank details, a UPI ID, both, or neither.
-- Same admin/superadmin-only visibility, enforced entirely in application code
-- (doctors.service.js#shapeDoctor's includeContact gate), not at the database layer.
--
-- Idempotent (safe to re-run): ADD COLUMN uses IF NOT EXISTS.

ALTER TABLE doctor_profiles ADD COLUMN IF NOT EXISTS bank_upi_id VARCHAR(150);
