ALTER TABLE "booking_rules"
  ADD COLUMN "advance_booking_window_start" TEXT,
  ADD COLUMN "advance_booking_window_end" TEXT;

-- Preserve existing platform hours for future-date bookings during the upgrade.
UPDATE "booking_rules" SET
  "advance_booking_window_start" = "online_booking_window_start",
  "advance_booking_window_end" = "online_booking_window_end";
