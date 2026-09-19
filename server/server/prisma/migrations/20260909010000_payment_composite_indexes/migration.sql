-- Scalability audit: payments.service.js#listPayments always filters on patientUserId or
-- doctorUserId (a patient's or doctor's own payment history) AND orders by createdAt desc in the
-- same query. The existing single-column indexes on those columns satisfy the filter but still
-- need a separate sort step; these composite indexes let Postgres use one index for both the
-- filter and the sort as payment volume grows (one row per appointment, so this only grows).
CREATE INDEX "payments_patient_user_id_created_at_idx" ON "payments" ("patient_user_id", "created_at");
CREATE INDEX "payments_doctor_user_id_created_at_idx" ON "payments" ("doctor_user_id", "created_at");
