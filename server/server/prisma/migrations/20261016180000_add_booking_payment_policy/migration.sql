CREATE TYPE "BookingPaymentPolicy" AS ENUM ('platform_only', 'minimum_or_full', 'full');

ALTER TABLE "doctor_profiles"
ADD COLUMN "booking_payment_policy" "BookingPaymentPolicy" NOT NULL DEFAULT 'full';

UPDATE "doctor_profiles"
SET "booking_payment_policy" = 'minimum_or_full'
WHERE "min_booking_advance_amount" IS NOT NULL
  AND "min_booking_advance_amount" > 0;

ALTER TABLE "appointments"
ADD COLUMN "booking_payment_policy" "BookingPaymentPolicy" NOT NULL DEFAULT 'full';
