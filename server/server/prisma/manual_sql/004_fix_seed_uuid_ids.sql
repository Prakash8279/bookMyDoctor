-- Fixes a real bug found by live-testing the app: prisma/seed.js originally gave the demo
-- city/area/clinic rows human-readable ids ("seed-city-mumbai", "seed-area-andheri",
-- "seed-clinic-demo") instead of proper UUIDs. Every route in the API validates :id-shaped
-- params and several query params (cityId, areaId, clinicId) with isUUID() — so any request
-- touching these specific rows (doctor's "OPD schedule" clinic dropdown, patient search
-- filtered by city/area, GET /clinics/:id, GET /receptionists?clinicId=..., etc.) was failing
-- with HTTP 422. This script renames those 3 rows (and only those 3 — Delhi/Bangalore/Bandra
-- have no dependents yet) to real UUIDs, updating every foreign key that points at them along
-- the way, without touching any other data (accounts, appointments, payments, etc. keep their
-- own already-correct UUIDs).
--
-- Safe to run once against the existing live database. Run this AFTER 000/001/002/003 have
-- already been applied (they have been, if you're at this point) and BEFORE re-running
-- `npm run seed` again (prisma/seed.js has been updated to use these same new ids, so re-running
-- the seed after this script is a no-op for these 3 rows — it will just match them by id).
--
-- Run via pgAdmin's Query Tool (open this file with the folder icon, then press ▶ / F5), same
-- as 001/002/003 were run.

BEGIN;

-- Cities with no rows pointing at them yet — simple direct id rename.
UPDATE cities SET id = '22222222-2222-4222-8222-222222222222' WHERE id = 'seed-city-delhi';
UPDATE cities SET id = '33333333-3333-4333-8333-333333333333' WHERE id = 'seed-city-bangalore';
UPDATE areas  SET id = '44444444-4444-4444-8444-444444444444' WHERE id = 'seed-area-bandra';

-- Mumbai — referenced by areas.city_id and clinics.city_id. Insert-new / repoint children /
-- delete-old, in that order, so nothing is ever left dangling mid-script.
INSERT INTO cities (id, name, state)
SELECT '11111111-1111-4111-8111-111111111111', name, state
FROM cities WHERE id = 'seed-city-mumbai';

UPDATE areas   SET city_id = '11111111-1111-4111-8111-111111111111' WHERE city_id = 'seed-city-mumbai';
UPDATE clinics SET city_id = '11111111-1111-4111-8111-111111111111' WHERE city_id = 'seed-city-mumbai';

DELETE FROM cities WHERE id = 'seed-city-mumbai';

-- Andheri West — referenced by clinics.area_id.
INSERT INTO areas (id, city_id, name, pincode)
SELECT '55555555-5555-4555-8555-555555555555', city_id, name, pincode
FROM areas WHERE id = 'seed-area-andheri';

UPDATE clinics SET area_id = '55555555-5555-4555-8555-555555555555' WHERE area_id = 'seed-area-andheri';

DELETE FROM areas WHERE id = 'seed-area-andheri';

-- Demo clinic — referenced by receptionist_profiles, doctor_clinics, doctor_clinic_hours,
-- doctor_clinic_closures, appointments, queue_tokens, payments. All of these have
-- onDelete:Cascade back to clinics in the Prisma schema, so children are repointed to the new
-- id BEFORE the old clinic row is deleted — if this were done in the other order, the cascade
-- would silently delete all of that data instead of preserving it.
INSERT INTO clinics (
  id, name, phone, address, city_id, area_id, approval_status, rejection_reason,
  emergency_available, payment_cash_enabled, payment_upi_enabled, payment_upi_id, payment_qr_url,
  created_at, updated_at
)
SELECT
  '66666666-6666-4666-8666-666666666666', name, phone, address, city_id, area_id, approval_status,
  rejection_reason, emergency_available, payment_cash_enabled, payment_upi_enabled, payment_upi_id,
  payment_qr_url, created_at, updated_at
FROM clinics WHERE id = 'seed-clinic-demo';

UPDATE receptionist_profiles SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE clinic_id = 'seed-clinic-demo';
UPDATE doctor_clinics         SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE clinic_id = 'seed-clinic-demo';
UPDATE doctor_clinic_hours    SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE clinic_id = 'seed-clinic-demo';
UPDATE doctor_clinic_closures SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE clinic_id = 'seed-clinic-demo';
UPDATE appointments            SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE clinic_id = 'seed-clinic-demo';
UPDATE queue_tokens            SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE clinic_id = 'seed-clinic-demo';
UPDATE payments                SET clinic_id = '66666666-6666-4666-8666-666666666666' WHERE clinic_id = 'seed-clinic-demo';

DELETE FROM clinics WHERE id = 'seed-clinic-demo';

COMMIT;

-- Verify: every row below should return zero.
-- SELECT count(*) FROM cities   WHERE id LIKE 'seed-%';
-- SELECT count(*) FROM areas    WHERE id LIKE 'seed-%';
-- SELECT count(*) FROM clinics  WHERE id LIKE 'seed-%';
