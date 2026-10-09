-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_holds" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "doctor_user_id" TEXT NOT NULL,
    "patient_user_id" TEXT NOT NULL,
    "appointment_date" DATE NOT NULL,
    "razorpay_order_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "hold_created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hold_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_holds_razorpay_order_id_key" ON "payment_holds"("razorpay_order_id");
CREATE INDEX IF NOT EXISTS "payment_holds_doctor_date_idx" ON "payment_holds"("doctor_user_id", "appointment_date");
CREATE INDEX IF NOT EXISTS "payment_holds_doctor_date_status_exp_idx" ON "payment_holds"("doctor_user_id", "appointment_date", "status", "hold_expires_at");
CREATE INDEX IF NOT EXISTS "payment_holds_appointment_id_idx" ON "payment_holds"("appointment_id");
CREATE INDEX IF NOT EXISTS "payment_holds_status_exp_idx" ON "payment_holds"("status", "hold_expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_hold_per_appointment" ON "payment_holds" ("appointment_id") WHERE status = 'PENDING';

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_holds_appointment_id_fkey'
    ) THEN
        ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_holds_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_holds_doctor_user_id_fkey'
    ) THEN
        ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_holds_doctor_user_id_fkey" FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_holds_patient_user_id_fkey'
    ) THEN
        ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_holds_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
