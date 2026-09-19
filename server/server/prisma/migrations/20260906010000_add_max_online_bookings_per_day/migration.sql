-- Doctor-set daily cap on online (patient self-service) bookings. NULL = no cap (default,
-- backward-compatible — existing rows get NULL, no behavior change until a doctor sets one).
ALTER TABLE "doctor_profiles" ADD COLUMN "max_online_bookings_per_day" INTEGER;
