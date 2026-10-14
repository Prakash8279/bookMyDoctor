-- Repair legacy rows created through older/admin paths, then make stable role IDs a database
-- invariant so no future code path can accidentally create a patient, doctor, or receptionist
-- without its permanent number.

WITH ranked AS (
  SELECT
    id,
    COALESCE((SELECT MAX(patient_number) FROM users), 0)
      + ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM users
  WHERE role = 'patient' AND patient_number IS NULL
)
UPDATE users u
SET patient_number = ranked.rn
FROM ranked
WHERE u.id = ranked.id;

WITH ranked AS (
  SELECT
    dp.user_id,
    COALESCE((SELECT MAX(doctor_number) FROM doctor_profiles), 0)
      + ROW_NUMBER() OVER (ORDER BY u.created_at, dp.user_id) AS rn
  FROM doctor_profiles dp
  JOIN users u ON u.id = dp.user_id
  WHERE dp.doctor_number IS NULL
)
UPDATE doctor_profiles dp
SET doctor_number = ranked.rn
FROM ranked
WHERE dp.user_id = ranked.user_id;

SELECT setval('patient_number_seq', COALESCE((SELECT MAX(patient_number) FROM users), 0) + 1, false);
SELECT setval('doctor_number_seq', COALESCE((SELECT MAX(doctor_number) FROM doctor_profiles), 0) + 1, false);
SELECT setval('receptionist_number_seq', COALESCE((SELECT MAX(receptionist_number) FROM receptionist_profiles), 0) + 1, false);

ALTER TABLE doctor_profiles
  ALTER COLUMN doctor_number SET DEFAULT nextval('doctor_number_seq'),
  ALTER COLUMN doctor_number SET NOT NULL;

ALTER TABLE receptionist_profiles
  ALTER COLUMN receptionist_number SET DEFAULT nextval('receptionist_number_seq'),
  ALTER COLUMN receptionist_number SET NOT NULL;

CREATE OR REPLACE FUNCTION assign_patient_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role = 'patient' AND NEW.patient_number IS NULL THEN
    NEW.patient_number := nextval('patient_number_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_assign_patient_number ON users;
CREATE TRIGGER users_assign_patient_number
BEFORE INSERT OR UPDATE OF role, patient_number ON users
FOR EACH ROW
EXECUTE FUNCTION assign_patient_number();

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_patient_number_required;
ALTER TABLE users
  ADD CONSTRAINT users_patient_number_required
  CHECK (role <> 'patient' OR patient_number IS NOT NULL);
