-- Payment holds reserve capacity, not queue numbers.
ALTER TABLE "appointments" ALTER COLUMN "token_number" DROP NOT NULL;

DELETE FROM "queue_tokens" q
USING "appointments" a
WHERE q.appointment_id = a.id AND q.status = 'on_hold'
  AND (a.status = 'pending_payment' OR (a.status = 'cancelled' AND a.payment_status = 'pending'));

UPDATE "appointments"
SET "token_number" = NULL
WHERE status = 'pending_payment'
   OR (status = 'cancelled' AND payment_status = 'pending' AND source = 'online'
       AND CASE WHEN booking_payment_policy = 'platform_only' THEN convenience_fee > 0 ELSE total_amount > 0 END
       AND NOT EXISTS (SELECT 1 FROM "payments" p WHERE p.appointment_id = appointments.id AND p.status IN ('paid', 'refunded')));
