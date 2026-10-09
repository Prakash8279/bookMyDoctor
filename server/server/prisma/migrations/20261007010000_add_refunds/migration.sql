-- CreateTable
CREATE TABLE IF NOT EXISTS "refunds" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "razorpay_payment_id" TEXT NOT NULL,
    "razorpay_refund_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_razorpay_refund_id_key" ON "refunds"("razorpay_refund_id");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_idempotency_key_key" ON "refunds"("idempotency_key");
CREATE INDEX IF NOT EXISTS "refunds_appointment_id_idx" ON "refunds"("appointment_id");
CREATE INDEX IF NOT EXISTS "refunds_payment_id_idx" ON "refunds"("payment_id");
CREATE INDEX IF NOT EXISTS "refunds_status_idx" ON "refunds"("status");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'refunds_appointment_id_fkey'
    ) THEN
        ALTER TABLE "refunds" ADD CONSTRAINT "refunds_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'refunds_payment_id_fkey'
    ) THEN
        ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
