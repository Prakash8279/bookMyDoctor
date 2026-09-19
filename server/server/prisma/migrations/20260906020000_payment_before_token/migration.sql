-- Payment-before-token feature: an online booking with a non-zero fee is now created as
-- `pending_payment` / a queue token `on_hold`, and only flips to `upcoming` / `waiting` once the
-- patient pays online (full amount, or the doctor's configured minimum advance amount).
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that later reads/writes rows
-- with the new value — this migration only ADDS the values, nothing in this file uses them, so
-- that restriction doesn't bite here.
ALTER TYPE "AppointmentStatus" ADD VALUE 'pending_payment';
ALTER TYPE "PaymentStatus" ADD VALUE 'partial';
ALTER TYPE "QueueStatus" ADD VALUE 'on_hold';

-- Doctor-configurable minimum online-advance amount (NULL = not configured, no behavior change
-- for any doctor who hasn't set one).
ALTER TABLE "doctor_profiles" ADD COLUMN "min_booking_advance_amount" DECIMAL(10,2);
