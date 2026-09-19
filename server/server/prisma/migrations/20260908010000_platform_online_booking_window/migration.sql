-- Platform-wide online-booking controls (admin/superadmin managed, booking_rules singleton):
--   1) A daily HH:MM-HH:MM window during which ONLINE bookings are accepted at all (NULL/NULL =
--      accepted around the clock, the default — no behavior change for anyone until an admin
--      explicitly sets both).
--   2) A rolling cap on how many days ahead an ONLINE booking's date may be (NULL = no
--      platform-wide cap beyond each doctor's own maxDaysAdvance setting; 0 = today only).
-- Neither ever affects walk-in/receptionist bookings — see appointments.service.js#runBookingJob.
ALTER TABLE "booking_rules" ADD COLUMN "online_booking_window_start" TEXT;
ALTER TABLE "booking_rules" ADD COLUMN "online_booking_window_end" TEXT;
ALTER TABLE "booking_rules" ADD COLUMN "online_booking_max_advance_days" INTEGER;
