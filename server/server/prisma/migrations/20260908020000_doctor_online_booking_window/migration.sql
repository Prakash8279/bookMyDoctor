-- Per-doctor override of the platform-wide online-booking accessibility window (see the
-- previous migration, 20260908010000_platform_online_booking_window, for the platform-wide
-- version on booking_rules). NULL/NULL (default) = this doctor has no override, so the platform-
-- wide window (if any) applies to them like everyone else.
ALTER TABLE "doctor_profiles" ADD COLUMN "online_booking_window_start" TEXT;
ALTER TABLE "doctor_profiles" ADD COLUMN "online_booking_window_end" TEXT;
