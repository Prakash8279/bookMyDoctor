-- Keep payment and other audit writes compatible with ActivityLog.ipAddress.
-- Existing rows have no recorded IP and remain NULL.
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;
