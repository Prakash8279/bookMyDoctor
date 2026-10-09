const prisma = require('../src/config/db');

async function main() {
  try {
    console.log('Applying migration 20261009010000_add_payment_holds...');

    // 1. Table
    await prisma.$executeRawUnsafe(`
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
    `);
    console.log('Table payment_holds created/verified.');

    // 2. Indexes
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "payment_holds_razorpay_order_id_key" ON "payment_holds"("razorpay_order_id");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_holds_doctor_date_idx" ON "payment_holds"("doctor_user_id", "appointment_date");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_holds_doctor_date_status_exp_idx" ON "payment_holds"("doctor_user_id", "appointment_date", "status", "hold_expires_at");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_holds_appointment_id_idx" ON "payment_holds"("appointment_id");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_holds_status_exp_idx" ON "payment_holds"("status", "hold_expires_at");`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_hold_per_appointment" ON "payment_holds" ("appointment_id") WHERE status = 'PENDING';`);
    console.log('Indexes created/verified.');

    // 3. Foreign Keys
    await prisma.$executeRawUnsafe(`
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
    `);
    console.log('Foreign keys created/verified.');

    // Check table
    const check = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payment_holds'
      ORDER BY ordinal_position;
    `);
    console.log('payment_holds columns in PostgreSQL:', check);
  } catch (err) {
    console.error('Error applying migration:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
