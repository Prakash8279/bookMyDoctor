const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { PrismaClient } = require(path.join(__dirname, 'node_modules', '@prisma', 'client'));

async function testFreshDatabase() {
  const currentUrl = process.env.DATABASE_URL;
  const freshDbUrl = currentUrl.replace('doctor_connect', 'doctor_connect_fresh_audit');

  console.log('1. Creating clean database doctor_connect_fresh_audit...');
  const mainPrisma = new PrismaClient();
  await mainPrisma.$executeRawUnsafe('DROP DATABASE IF EXISTS doctor_connect_fresh_audit;');
  await mainPrisma.$executeRawUnsafe('CREATE DATABASE doctor_connect_fresh_audit;');
  await mainPrisma.$disconnect();
  console.log('Clean database doctor_connect_fresh_audit created.');

  console.log('2. Running npx prisma migrate deploy against fresh database...');
  const deployOutput = execSync('npx prisma migrate deploy', {
    cwd: __dirname,
    env: { ...process.env, DATABASE_URL: freshDbUrl }
  }).toString();
  console.log(deployOutput);

  console.log('3. Verifying schema, tables, constraints, and indexes...');
  const testPrisma = new PrismaClient({
    datasources: { db: { url: freshDbUrl } }
  });

  const tables = await testPrisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  console.log(`Total Tables created: ${tables.length}`);

  const phoneIndex = await testPrisma.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_phone_key';
  `);
  console.log('users_phone_key:', phoneIndex);

  const slotIndex = await testPrisma.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'appointments' AND indexname = 'appointments_doctor_slot_unique';
  `);
  console.log('appointments_doctor_slot_unique:', slotIndex);

  const receiptSeq = await testPrisma.$queryRawUnsafe(`
    SELECT sequence_name FROM information_schema.sequences WHERE sequence_name = 'payment_receipt_seq';
  `);
  console.log('payment_receipt_seq:', receiptSeq);

  const refundsTable = await testPrisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'refunds';
  `);
  console.log('refunds table:', refundsTable);

  const passed = (
    tables.length >= 29 &&
    phoneIndex.length === 1 &&
    slotIndex.length === 1 &&
    receiptSeq.length === 1 &&
    refundsTable.length === 1
  );

  await testPrisma.$disconnect();

  console.log('4. Cleaning up test database...');
  const cleanupPrisma = new PrismaClient();
  await cleanupPrisma.$executeRawUnsafe('DROP DATABASE IF EXISTS doctor_connect_fresh_audit;');
  await cleanupPrisma.$disconnect();
  console.log('Cleaned up doctor_connect_fresh_audit.');

  if (passed) {
    console.log('=== Fresh Database Reproducibility: PASS ===');
  } else {
    console.log('=== Fresh Database Reproducibility: FAIL ===');
    process.exit(1);
  }
}

testFreshDatabase().catch(err => {
  console.error('Fresh DB test failed:', err);
  process.exit(1);
});
