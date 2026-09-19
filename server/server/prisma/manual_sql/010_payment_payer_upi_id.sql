-- BookMyDoctor24 — payer's UPI ID on a recorded payment (receptionist Cash Payment page).
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE, same reason 001-009 are hand-written: this sandbox has
-- no DB/network access to run `npx prisma migrate dev`. Run this by hand via psql/pgAdmin
-- against the real database.
--
-- Context (request: "utr no aaye upi id aaye ushke pad use show ho", clarified to always show on
-- the Cash Payment form and to be saved, not just displayed): one nullable column on `payments`.
-- The existing `transaction_ref` column already covers the "UTR / transaction number" half of the
-- request (just relabeled client-side) — this migration adds only the missing half, the payer's
-- own UPI handle for that specific transaction. Distinct from doctor_profiles.bank_upi_id (the
-- doctor's own payout UPI id from the earlier bank-details feature, 009) — this one belongs to
-- whoever paid, not whoever is being paid out.
--
-- Idempotent (safe to re-run): ADD COLUMN uses IF NOT EXISTS.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_upi_id VARCHAR(150);
