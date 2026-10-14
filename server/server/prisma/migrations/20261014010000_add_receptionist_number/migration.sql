-- Stable, sequential receptionist IDs (DCR1, DCR2, ...), matching the existing
-- patient_number_seq / doctor_number_seq pattern.
CREATE SEQUENCE IF NOT EXISTS receptionist_number_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE receptionist_profiles
  ADD COLUMN IF NOT EXISTS receptionist_number INTEGER;

WITH ranked AS (
  SELECT
    rp.user_id,
    COALESCE((SELECT MAX(receptionist_number) FROM receptionist_profiles), 0)
      + ROW_NUMBER() OVER (ORDER BY u.created_at, rp.user_id) AS rn
  FROM receptionist_profiles rp
  JOIN users u ON u.id = rp.user_id
  WHERE rp.receptionist_number IS NULL
)
UPDATE receptionist_profiles rp
SET receptionist_number = ranked.rn
FROM ranked
WHERE rp.user_id = ranked.user_id;

SELECT setval(
  'receptionist_number_seq',
  COALESCE((SELECT MAX(receptionist_number) FROM receptionist_profiles), 0) + 1,
  false
);

CREATE UNIQUE INDEX IF NOT EXISTS receptionist_profiles_receptionist_number_key
  ON receptionist_profiles (receptionist_number);
