-- Online capacity is a doctor-day quota. Estimated call times are not exclusive slots.
ALTER TABLE appointments ADD COLUMN is_estimated_time BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN estimated_visit_at TIMESTAMP(3);
DROP INDEX IF EXISTS appointments_doctor_slot_unique;
CREATE UNIQUE INDEX appointments_doctor_slot_unique
  ON appointments (doctor_user_id, appointment_date, appointment_time)
  WHERE status NOT IN ('cancelled', 'no_show') AND NOT is_estimated_time;
